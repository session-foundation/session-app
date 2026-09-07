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
    path: `^packages/(?!${[pkg, ...allowed].join('|')})[^/]+/`,
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
    mayOnlyDependOn('basic-types', []),
    mayOnlyDependOn('bridge-types', []),
    mayOnlyDependOn('test-ids', []),
    mayOnlyDependOn('theme-tokens', ['basic-types']),
    mayOnlyDependOn('localization', ['basic-types']),
    mayOnlyDependOn('proto', ['basic-types']),
    mayOnlyDependOn('client', ['proto', 'basic-types', 'bridge-rn', 'bridge-types']),
    mayOnlyDependOn('client-contract', ['client', 'proto', 'basic-types']),
    mayOnlyDependOn('state', ['client', 'basic-types']),
    mayOnlyDependOn('ui', ['theme-tokens', 'test-ids', 'basic-types']),
    mayOnlyDependOn('app', ['client', 'state', 'basic-types']),
    mayOnlyDependOn('bridge-node', ['client', 'client-contract', 'proto', 'bridge-types']),
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
        path: '^packages/(basic-types|test-ids|theme-tokens|localization|proto|client|client-contract|state|app|screens)/',
        pathNot: '\\.(native|web|ios|android)\\.tsx?$',
      },
      to: { dependencyTypes: ['npm', 'npm-dev'], path: `^(${platformOnlyModules.join('|')})($|/)` },
    },
    {
      name: 'shared-has-no-node-builtins',
      severity: 'error',
      from: {
        path: '^packages/(basic-types|test-ids|theme-tokens|localization|proto|client|client-contract|state|app|screens|ui)/',
        pathNot: '\\.(test|spec)\\.tsx?$',
      },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'ui-owns-tamagui',
      comment:
        'Only packages/ui may import tamagui. Everyone else imports the wrapper from @session/ui.',
      severity: 'error',
      from: { path: '^(packages/(?!ui)[^/]+|apps)/' },
      to: { path: '^(tamagui|@tamagui/)', dependencyTypes: ['npm', 'npm-dev'] },
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
      severity: 'warn',
      from: {
        orphan: true,
        pathNot:
          '(\\.d\\.ts$|^tooling/|(^|/)[^/]+\\.config\\.[cm]?[jt]s$|^apps/[^/]+/src/(main|preload|renderer)/(index|main)\\.tsx?$)',
      },
      to: {},
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: {
      path: '(node_modules|/gen/|/generated/|dist/|build/|/out/|tests/bench/mobile/web/|tests/bench/mobile/src/nitro-stub)',
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
