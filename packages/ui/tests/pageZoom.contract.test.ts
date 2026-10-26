import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * `pageZoom.ts` makes Tamagui's `onLayout` report sizes in the page's own units by setting a global
 * Tamagui reads, which it does not document. An upgrade that stopped reading it would leave every
 * measured size off by the desktop zoom at anything but 100%, and nothing would fail -- so this
 * does, by reading the installed Tamagui for the name `pageZoom.ts` sets.
 */
describe('the onLayout flag pageZoom sets', () => {
  const ours = readFileSync(join(import.meta.dirname, '../src/pageZoom.ts'), 'utf8')
  const flag = /__TAMAGUI_ONLAYOUT_\w+/.exec(ours)?.[0]

  it('is set by pageZoom', () => {
    expect(flag).toBeDefined()
  })

  it('is still read by the installed Tamagui', () => {
    // Followed through Tamagui's own dependencies, so it is the copy Tamagui loads that is read
    const from = (path: string, spec: string) => createRequire(path).resolve(spec)
    const tamagui = from(import.meta.filename, 'tamagui/package.json')
    const core = from(tamagui, '@tamagui/core/package.json')
    const layout = from(core, '@tamagui/use-element-layout/package.json')
    const source = readFileSync(join(dirname(layout), 'dist/esm/index.mjs'), 'utf8')
    expect(source).toContain(`globalThis.${String(flag)}`)
  })
})
