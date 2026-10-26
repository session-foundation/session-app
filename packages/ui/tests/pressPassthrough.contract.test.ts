import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const SRC = join(import.meta.dirname, '../src')

/** Every shared component that wraps its frame in a `PressArea`. */
const wrappers = readdirSync(SRC)
  .filter((file) => file.endsWith('.tsx') && !file.startsWith('PressArea'))
  .map((file) => ({ file, source: readFileSync(join(SRC, file), 'utf8') }))
  .filter(({ source }) => source.includes('<PressArea'))

/**
 * On native, tamagui gives any view declaring a `pressStyle`, or naming a `group` its children
 * style the press of, its own press handling, so the frame claims the touch and the `Pressable`
 * around it never fires; the web is unaffected. A grep because this package has no native renderer
 * to press with.
 */
describe('a PressArea frame that styles its own press', () => {
  it('is found by this test at all, so a move cannot make it vacuous', () => {
    expect(wrappers.map(({ file }) => file)).toEqual(
      expect.arrayContaining(['Button.tsx', 'SettingsRow.tsx']),
    )
  })

  it('spreads PRESS_PASSTHROUGH', () => {
    const missing = wrappers
      .filter(
        ({ source }) =>
          /\b(pressStyle|group)[=:]/.test(source) && !/\.\.\.PRESS_PASSTHROUGH/.test(source),
      )
      .map(({ file }) => file)
    expect(missing).toEqual([])
  })
})
