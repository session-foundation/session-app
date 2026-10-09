/**
 * The boundary authority.
 *
 * ESLint's zone matrix (tooling/eslint-config/zones.js) says the same things at the module
 * level while you type; this sees the whole graph at once and is what CI believes. When the
 * two disagree, this file is right and the other one is out of date.
 *
 * Run: pnpm boundaries
 */

/** A package may depend on the listed siblings and no others. */
const mayOnlyDependOn = (pkg, allowed) => ({
  name: `${pkg}-package-graph`,
  comment: `packages/${pkg} may only import: ${allowed.join(', ') || '(no sibling packages)'}`,
  severity: 'error',
  from: { path: `^packages/${pkg}/` },
  to: {
    path: `^packages/(?!(${[pkg, ...allowed].join('|')})/)[^/]+/`,
  },
})

/** Modules a universal package must never reach for, whatever the platform. */
const platformOnlyModules = [
  'electron',
  'react-native',
  'expo',
  'expo-router',
  '@session/bridge-rn',
  '@session/bridge-node',
]

module.exports = {
  forbidden: [
    // ---- Package graph -----------------------------------------------------
    // The one sibling it may have: five types are shared with the protocol, and nitrogen cannot
    // resolve them across a package boundary, so bridge-types declares them and this re-exports.
    mayOnlyDependOn('basic-types', ['bridge-types']),
    mayOnlyDependOn('bridge-types', []),
    mayOnlyDependOn('test-ids', []),
    mayOnlyDependOn('theme-tokens', ['basic-types']),
    mayOnlyDependOn('localization', ['basic-types']),
    mayOnlyDependOn('client', ['basic-types', 'bridge-rn', 'bridge-types']),
    mayOnlyDependOn('client-contract', ['client', 'basic-types']),
    mayOnlyDependOn('state', ['client', 'basic-types']),
    mayOnlyDependOn('ui', ['theme-tokens', 'test-ids', 'basic-types']),
    mayOnlyDependOn('app', ['client', 'client-contract', 'state', 'basic-types']),
    mayOnlyDependOn('bridge-node', ['client', 'client-contract', 'bridge-types']),
    mayOnlyDependOn('bridge-rn', ['bridge-types']),
    mayOnlyDependOn('screens', [
      'ui',
      'state',
      'app',
      'client',
      'localization',
      'test-ids',
      'basic-types',
    ]),

    {
      name: 'no-one-imports-apps',
      comment: 'Apps are adapters at the top of the graph; nothing may depend on one.',
      severity: 'error',
      from: { pathNot: '^apps/' },
      to: { path: '^apps/' },
    },
    {
      name: 'apps-do-not-import-each-other',
      severity: 'error',
      from: { path: '^apps/([^/]+)/' },
      to: { path: '^apps/', pathNot: '^apps/$1/' },
    },

    // ---- Environment split -------------------------------------------------
    {
      name: 'shared-is-platform-neutral',
      comment:
        'Shared packages run on Hermes, in a browser and in Node. Wrap platform APIs in @session/ui or a port.',
      severity: 'error',
      from: {
        path: '^packages/(basic-types|bridge-types|test-ids|theme-tokens|localization|client|client-contract|state|app|screens)/',
        pathNot: '\\.(native|web|ios|android)\\.tsx?$',
      },
      to: {
        dependencyTypes: ['npm', 'npm-dev'],
        path: `^node_modules/(${platformOnlyModules.join('|')})($|/)`,
      },
    },
    {
      name: 'shared-has-no-node-builtins',
      comment:
        'Shared packages run on three platforms, and two of them have no node. Tests are exempt ' +
        "because they only ever run under vitest, and so is a package's scripts/ directory, " +
        'which is build-time codegen invoked by `pnpm codegen` and never bundled into anything.',
      severity: 'error',
      from: {
        path: '^packages/(basic-types|bridge-types|test-ids|theme-tokens|localization|client|client-contract|state|app|screens|ui)/',
        pathNot: '\\.(test|spec)\\.tsx?$|^packages/[^/]+/scripts/',
      },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'expo-belongs-to-the-mobile-app',
      comment:
        'Expo modules are native code built into apps/mobile. @session/ui is exempt from the ' +
        'platform-neutral rule because both apps bundle react-native, but an expo-* import there ' +
        'reaches the desktop bundle too, where there is no Expo and no native module to load. ' +
        'A platform view belongs behind a port the app fills - see backdropBlur.ts.',
      severity: 'error',
      from: { pathNot: '^apps/mobile/' },
      to: { path: '^node_modules/expo($|[-/])', dependencyTypes: ['npm', 'npm-dev'] },
    },
    {
      name: 'ui-owns-tamagui',
      comment:
        'Only packages/ui may import tamagui. Everyone else imports the wrapper from @session/ui.',
      severity: 'error',
      from: { path: '^(packages/(?!ui)[^/]+|apps)/' },
      to: { path: '^node_modules/(tamagui|@tamagui/)', dependencyTypes: ['npm', 'npm-dev'] },
    },

    // ---- Bindings ----------------------------------------------------------
    {
      name: 'nitro-module-is-linked-once',
      comment:
        'Only packages/client/src/*.native.* links the Nitro module; everything else takes a BridgeTransport.',
      severity: 'error',
      from: { pathNot: '^packages/(bridge-rn|client/src/[^/]*\\.native\\.tsx?)' },
      to: { path: '^packages/bridge-rn/' },
    },
    {
      name: 'addon-loads-in-desktop-main',
      comment:
        'The N-API addon loads in the desktop main process only; the renderer talks over the preload bridge.',
      severity: 'error',
      from: { pathNot: '^(packages/bridge-node|apps/desktop/src/(main|worker))/' },
      to: { path: '^packages/bridge-node/' },
    },
    {
      name: 'fake-never-ships',
      comment: 'The fake SessionClient belongs to tests and dev entries.',
      severity: 'error',
      from: {
        pathNot:
          '(\\.(test|spec)\\.tsx?$|^tests/|/dev/|^packages/client/src/fake/|^packages/client-contract/)',
      },
      to: { path: '^packages/client/src/fake/' },
    },

    // ---- Hygiene -----------------------------------------------------------
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-undeclared-deps',
      comment: "Every import must be declared in that package's own package.json.",
      severity: 'error',
      from: { pathNot: '\\.(test|spec)\\.tsx?$' },
      to: { dependencyTypes: ['npm-no-pkg', 'npm-unknown'] },
    },
    {
      name: 'no-orphans',
      comment: 'A .native file is only reachable through Metro resolution; native.cjs checks it.',
      severity: 'error',
      from: {
        orphan: true,
        pathNot:
          '(\\.d\\.ts$|\\.native\\.tsx?$|^tooling/|(^|/)[^/]+\\.config\\.[cm]?[jt]s$|^apps/[^/]+/src/(main|preload|renderer)/(index|main)\\.tsx?$)',
      },
      to: {},
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'src-not-to-tests',
      severity: 'error',
      from: { path: '^(packages|apps)/[^/]+/src/' },
      to: { path: '^(packages/[^/]+/tests/|apps/[^/]+/tests/|tests/)' },
    },
    {
      name: 'not-to-dev-dep',
      comment:
        "Shipped code needs its import at runtime. A peer is the consumer's to provide, and " +
        'the electron module is provided by the Electron runtime rather than bundled.',
      severity: 'error',
      from: {
        path: '^(packages|apps)/[^/]+/src/',
        pathNot: '\\.(test|spec)\\.tsx?$|/dev/',
      },
      to: {
        dependencyTypes: ['npm-dev'],
        dependencyTypesNot: ['type-only', 'npm-peer'],
        pathNot: '^node_modules/electron/',
      },
    },
    {
      name: 'no-duplicate-dep-types',
      comment:
        'Any pair that includes a peer is exempt: peer plus devDependency is how a library gets it ' +
        'for its own tests, and peer plus dependency falls under the same exemption.',
      severity: 'error',
      from: {},
      to: { moreThanOneDependencyType: true, dependencyTypesNot: ['type-only', 'npm-peer'] },
    },
    {
      name: 'not-to-deprecated',
      severity: 'error',
      from: {},
      to: { dependencyTypes: ['deprecated'] },
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: {
      path: '(/gen/|/generated/|dist/|build/|/out/)',
    },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'default'],
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
}
