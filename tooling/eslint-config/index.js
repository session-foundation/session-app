import js from '@eslint/js'
import importX from 'eslint-plugin-import-x'
import tseslint from 'typescript-eslint'

import { caseCollision } from './caseCollision.js'
import { commentLength } from './commentLength.js'
import {
  desktopMainZone,
  desktopRendererZone,
  mobileAppZone,
  mobileStorageZone,
  sharedZone,
  uiZone,
  universalZone,
} from './zones.js'

export {
  desktopMainZone,
  desktopRendererZone,
  mobileAppZone,
  mobileStorageZone,
  sharedZone,
  uiZone,
  universalZone,
}

/**
 * The repo-wide base, plus this package's zone.
 *
 * The zone is passed in rather than appended by the caller so that it lands before the
 * test-file override: a zone spread after it would silently switch the import rules back on
 * for tests, which is where the fake is supposed to be used.
 *
 * @param {{ tsconfigRootDir: string, zone?: import('eslint').Linter.RulesRecord }} options
 */
/**
 * Props whose value resolves against a token scale rather than being a measurement.
 *
 * One list, because the two selectors that use it have to agree: a prop covered in JSX and missed
 * in a style object leaves the hole exactly where the style object is the harder spelling to spot.
 *
 * Deliberately not `width`, `height` or `flexBasis` -- those carry real measurements often enough
 * that the rule would be noise, and a size token is a different question from a space one.
 */
const SCALED_PROPS = [
  // Every component that takes `size` resolves it against a named scale, so a number here is
  // never the measurement a `width` can legitimately be.
  'size',
  'padding',
  'paddingHorizontal',
  'paddingVertical',
  'paddingTop',
  'paddingBottom',
  'paddingStart',
  'paddingEnd',
  'paddingLeft',
  'paddingRight',
  'margin',
  'marginHorizontal',
  'marginVertical',
  'marginTop',
  'marginBottom',
  'marginStart',
  'marginEnd',
  'marginLeft',
  'marginRight',
  'gap',
  'columnGap',
  'rowGap',
  'space',
  'borderRadius',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomLeftRadius',
  'borderBottomRightRadius',
  'fontSize',
].join('|')

/**
 * A function named like a component, and a named function inside it that renders.
 *
 * A callback handed straight to a call or a prop (`items.map((x) => <X />)`, `renderItem={...}`,
 * a render-prop child) has no name to be reused under, so it does not count.
 */
const COMPONENT =
  ':matches(FunctionDeclaration[id.name=/^[A-Z]/], FunctionExpression[id.name=/^[A-Z]/], ' +
  'VariableDeclarator[id.name=/^[A-Z]/] > :matches(ArrowFunctionExpression, FunctionExpression))'
const NESTED_RENDER =
  ':matches(FunctionDeclaration, VariableDeclarator > :matches(ArrowFunctionExpression, ' +
  'FunctionExpression)):has(JSXElement, JSXFragment)'

const RESTRICTED_SYNTAX = [
  {
    selector: 'TSImportType',
    message: "Add a top-level `import type { T } from '...'` instead of an inline import() type.",
  },
  // A bare number on a prop that reads a token scale. Both spellings are covered, because
  // a literal is invisible to anything that checks tokens: it is not a token resolving to
  // the wrong value, it is a value that never asked the scale. `$none` is the zero.
  {
    selector:
      'JSXAttribute[name.name=/^' +
      SCALED_PROPS +
      '$/] > JSXExpressionContainer > Literal[raw=/^[0-9]+(\\.[0-9]+)?$/]',
    message:
      'Name a token here ("$md", "$none") rather than a number, so the scale stays the ' +
      'single place a value changes. If the number is deliberately off-scale -- a measured ' +
      'client value -- give it a named constant and disable this rule with the reason.',
  },
  {
    selector: `${COMPONENT} ${NESTED_RENDER}`,
    message:
      'A component or render function defined inside a component is rebuilt on every ' +
      'render: drawn as <Inner /> React remounts it, and either way it cannot be memoised. ' +
      'Move it to module scope and pass what it reads as props.',
  },
  // On iOS 17+ `cursor` is a UIHoverStyle, whose hover effect inserts views React Native does not
  // track: on an iPad with a pointer, unmounting the view's siblings then aborts the app. The
  // cursor only means something to a mouse on the web, so it goes under `$platform-web`.
  {
    selector: "JSXAttribute[name.name='cursor']",
    message:
      "Set the cursor for the web only: `$platform-web={{ cursor: 'pointer' }}`. On an iPad it " +
      'becomes a UIKit hover effect that crashes React Native when the view is unmounted.',
  },
  {
    selector:
      "Property[key.name='cursor']:not(JSXAttribute[name.name='$platform-web'] Property)" +
      ":not(Property[key.value='$platform-web'] Property)",
    message:
      "Set the cursor for the web only: `'$platform-web': { cursor: 'pointer' }`. On an iPad it " +
      'becomes a UIKit hover effect that crashes React Native when the view is unmounted.',
  },
  // react-native-web ignores `adjustsFontSizeToFit`, so a line given it shrinks on a phone and is
  // cut off on desktop. `FitText` does the same on all three.
  {
    selector: "JSXAttribute[name.name='adjustsFontSizeToFit']",
    message:
      'Use `FitText` from @session/ui for a line that shrinks to fit: the web ignores ' +
      '`adjustsFontSizeToFit`, so on desktop the line is cut off instead.',
  },
  {
    selector: 'Property[key.name=/^' + SCALED_PROPS + '$/] > Literal[raw=/^[0-9]+(\\.[0-9]+)?$/]',
    message:
      'Name a token here rather than a number, so the scale stays the single place a ' +
      'value changes. If it is deliberately off-scale, give it a named constant and ' +
      'disable this rule with the reason.',
  },
]

const IPC_REGISTRATION = 'on|once|addListener|prependListener|handle|handleOnce'

/**
 * Desktop main: IPC is registered on a window's own `webContents.ipc`, and every handler checks
 * its sender. Spread in place of the base rule, which a second `no-restricted-syntax` replaces.
 */
export const desktopMainIpcRules = {
  'no-restricted-syntax': [
    'error',
    ...RESTRICTED_SYNTAX,
    {
      selector: "Identifier[name='ipcMain']",
      message:
        "Register on the window's `webContents.ipc`, not `ipcMain`: every WebContents can reach " +
        'ipcMain, including ones the app did not make.',
    },
    {
      selector:
        'CallExpression[callee.property.name=/^(' +
        IPC_REGISTRATION +
        ")$/]:matches([callee.object.name='ipc'], [callee.object.property.name='ipc'])" +
        " > :function:not(:has(CallExpression[callee.name='isFromAppFrame']))",
      message:
        'An IPC handler checks its sender with `isFromAppFrame(event.senderFrame, appUrl)`: ' +
        "a frame inside the page can send on the window's `ipc` too.",
    },
  ],
}

export function baseConfig({ tsconfigRootDir, zone }) {
  return tseslint.config(
    { ignores: ['dist/**', 'out/**', 'build/**', 'coverage/**', '**/gen/**', '**/generated/**'] },
    js.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    {
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir },
      },
      plugins: {
        'import-x': importX,
        session: { rules: { 'case-collision': caseCollision, 'comment-length': commentLength } },
      },
      settings: {
        'import-x/resolver': { typescript: { alwaysTryTypes: true } },
      },
      rules: {
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
        '@typescript-eslint/consistent-type-imports': [
          'error',
          { fixStyle: 'separate-type-imports' },
        ],
        '@typescript-eslint/no-floating-promises': 'error',
        '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
        '@typescript-eslint/await-thenable': 'error',
        '@typescript-eslint/no-unnecessary-type-assertion': 'error',
        '@typescript-eslint/no-explicit-any': 'warn',
        '@typescript-eslint/no-unsafe-argument': 'warn',
        '@typescript-eslint/no-unsafe-assignment': 'warn',
        '@typescript-eslint/no-unsafe-call': 'warn',
        '@typescript-eslint/no-unsafe-member-access': 'warn',
        '@typescript-eslint/no-unsafe-return': 'warn',

        // Walking into node_modules makes this rule parse react-native's Flow entry point.
        'import-x/no-cycle': ['error', { ignoreExternal: true }],
        'import-x/no-self-import': 'error',
        'import-x/no-duplicates': 'error',
        // TypeScript resolves without extensions; ".js" is not this repo's convention.
        'import-x/extensions': ['error', 'never', { json: 'always' }],
        'session/case-collision': 'error',
        'session/comment-length': 'error',

        'no-restricted-syntax': ['error', ...RESTRICTED_SYNTAX],
      },
    },
    {
      // Platform variants have no tsconfig that owns them: apps/mobile typechecks the
      // .native ones through moduleSuffixes, and the desktop renderer the plain ones.
      files: ['**/*.native.ts', '**/*.native.tsx', '**/*.web.ts', '**/*.web.tsx'],
      extends: [tseslint.configs.disableTypeChecked],
    },
    {
      // Config files and codegen scripts sit outside every tsconfig's `include`, so the project
      // service has no types for them. Both are plain ESM run by node at build time, and there is
      // nothing type-aware worth asserting about either; without this a script is a parse error
      // rather than a lint result.
      files: ['**/*.config.{js,mjs,cjs,ts}', '**/*.cjs', '**/scripts/**/*.{js,mjs,cjs}'],
      extends: [tseslint.configs.disableTypeChecked],
      languageOptions: { globals: { console: 'readonly', process: 'readonly' } },
    },
    ...(zone ? [{ rules: zone }] : []),
    {
      // A whole-Program selector, because the offence is where the file is rather than anything
      // in it: a package's `src` is its published source tree, and a test there ships with it.
      // Scoped to a package's or app's own source tree. The repo's top-level `tests/` is where
      // cross-cutting test code already lives -- the bench harness keeps its specs beside the
      // fixtures they measure, and moving those would mean `tests/bench/tests/`.
      files: [
        'packages/*/src/**/*.{test,spec}.{ts,tsx}',
        'apps/*/src/**/*.{test,spec}.{ts,tsx}',
        'tooling/*/src/**/*.{test,spec}.{ts,tsx}',
      ],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector: 'Program',
            message:
              "Tests live in the package's `tests/` directory, never in `src/`, mirroring the " +
              'src path they cover. Reach back into the package with `#src/*`.',
          },
        ],
      },
    },
    {
      files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx'],
      rules: {
        '@typescript-eslint/no-non-null-assertion': 'off',
        // The zone matrix is editor feedback for production code. Tests legitimately reach
        // for the fake and for platform modules, and dependency-cruiser - which is the
        // authority - already encodes which of those are allowed and where.
        'no-restricted-imports': 'off',
      },
    },
  )
}
