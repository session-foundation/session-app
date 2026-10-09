import { describe, expect, it } from 'vitest'

import { importViolations, type WorkspacePackage } from '#src/manifests'

const SHIPPED = 'apps/desktop/src/renderer/App.tsx'

function pkg(
  text: string,
  declared: string[] = [],
  { devOnly = [] as string[], path = SHIPPED } = {},
): WorkspacePackage {
  return {
    name: '@session/desktop',
    directory: 'apps/desktop',
    declared: new Set([...declared, ...devOnly]),
    devOnly: new Set(devOnly),
    sources: [{ path, text }],
  }
}

const DEV = { devOnly: ['@session/bridge-rn'] }
const USES_DEV = "import { createSessionBridge } from '@session/bridge-rn'\n"

describe('importViolations', () => {
  /**
   * Typecheck and lint pass on this; a bundler resolving from the package, as electron-vite does,
   * does not.
   */
  it('finds a sibling imported without being declared', () => {
    expect(importViolations([pkg("import { tr } from '@session/localization'\n")])).toEqual([
      {
        package: '@session/desktop',
        file: SHIPPED,
        imports: '@session/localization',
        rule: 'undeclared-import',
      },
    ])
  })

  it('accepts a declared sibling, and a package importing itself', () => {
    const text = "import { tr } from '@session/localization'\nimport x from '@session/desktop'\n"
    expect(importViolations([pkg(text, ['@session/localization'])])).toEqual([])
  })

  it('reads every form an import takes', () => {
    const text = [
      "import type { A } from '@session/a'",
      "export { B } from '@session/b'",
      "const c = await import('@session/c')",
      "const d = require('@session/d')",
      "import '@session/e'",
      'import {',
      '  F,',
      "} from '@session/f/sub'",
    ].join('\n')
    expect(importViolations([pkg(text)]).map((found) => found.imports)).toEqual([
      '@session/a',
      '@session/b',
      '@session/c',
      '@session/d',
      '@session/e',
      '@session/f',
    ])
  })

  it('ignores packages outside the workspace scope', () => {
    expect(importViolations([pkg("import { View } from 'react-native'\n")])).toEqual([])
  })

  /** depcruise's not-to-dev-dep never sees a sibling: the tsconfig alias makes it a local path. */
  it('refuses a shipped file importing a sibling listed only under devDependencies', () => {
    expect(importViolations([pkg(USES_DEV, [], DEV)]).map((found) => found.rule)).toEqual([
      'shipped-imports-dev-dep',
    ])
  })

  it('lets a test, a dev entry and a scripts file import a devDependency', () => {
    for (const path of [
      'apps/desktop/tests/transport.test.ts',
      'apps/desktop/src/transport.test.ts',
      'apps/desktop/src/dev/seed.ts',
      'apps/desktop/scripts/generate.ts',
    ])
      expect(importViolations([pkg(USES_DEV, [], { ...DEV, path })])).toEqual([])
  })

  it('lets shipped code take types alone from a devDependency, and no more', () => {
    const types =
      "import type {\n  NativeFrame,\n} from '@session/bridge-rn'\nexport type { X } from '@session/bridge-rn'\n"
    expect(importViolations([pkg(types, [], DEV)])).toEqual([])
    const mixed = `${types}const d = require('@session/bridge-rn')\n`
    expect(importViolations([pkg(mixed, [], DEV)]).map((found) => found.rule)).toEqual([
      'shipped-imports-dev-dep',
    ])
  })
})
