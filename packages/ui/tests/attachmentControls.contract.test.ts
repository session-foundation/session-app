import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * What a test and a screen reader can ask of the attachment controls, held by reading the source.
 *
 * A grep rather than a render test: `packages/ui` renders nothing in its unit tier, and the
 * failures here are in the native accessibility tree - an id on a node the tree hides, or a state
 * the face never exposes - which no browser shows either.
 */
function source(file: string): string {
  return readFileSync(join(import.meta.dirname, '../src', file), 'utf8')
}

describe('the album’s download cloud', () => {
  const hint = source('FetchHint.tsx')
  // Everything a pressable cloud carries is in the one spread that `onPress` switches on.
  const pressable =
    /onPress === undefined\s*\?\s*\{\}\s*:\s*\{([\s\S]*?)\}\)\}/.exec(hint)?.[1] ?? ''

  it('is the set’s named control where it takes the press', () => {
    expect(pressable).toContain("role: 'button'")
    expect(pressable).toContain("'aria-label': label")
    expect(pressable).toContain('testID')
  })

  it('is an accessibility element on iOS, which tamagui makes only a stack with tabIndex 0', () => {
    expect(pressable).toContain('isWeb ? {} : { tabIndex: 0 }')
  })

  it('is not hidden from the tree its id is looked up in', () => {
    expect(hint).not.toContain('aria-hidden')
  })
})

describe('the segmented toggle', () => {
  const toggle = source('SegmentedToggle.tsx')
  // Each path on its own, so one cannot answer for the other: the touch branch up to the
  // pointer path's `return`, and the pointer path's segment button.
  const whole = toggle.indexOf("SEGMENT_TAPS === 'whole'")
  const touch = toggle.slice(whole, toggle.indexOf('\n  return (', whole))
  const pointer = toggle.slice(
    toggle.indexOf('function SegmentButton'),
    toggle.indexOf('export function'),
  )

  it('says on each segment button whether it is the chosen one', () => {
    // On the button a reader lands on: ARIA defines no `aria-selected` on a button or its face.
    expect(pointer).toContain('toggled={selected}')
    expect(toggle).not.toContain('aria-selected')
    expect(source('PressArea.tsx')).toContain("'aria-pressed': toggled")
  })

  it('is one switch on touch, addressed by its own id, with no id inside it', () => {
    // iOS hides an accessible Pressable's children from the tree a test looks ids up in.
    expect(touch).toMatch(/role="switch"\s+checked=\{selected === 1\}/)
    expect(touch).toContain('testID={testID}')
    expect(touch.match(/testID=/g)?.length).toBe(1)
  })

  it('lights a face from the press the PressArea reports, since the face passes the touch through', () => {
    for (const path of [touch, pointer]) {
      expect(path).toMatch(/\{\(pressed\) =>[\s\S]*?<SegmentFace[^>]*pressed=\{pressed\b/)
    }
    expect(toggle).toMatch(/<StateLayer[^>]*pressed=\{pressed\}/)
  })
})

describe('the three-up’s cloud', () => {
  const album = source('AttachmentAlbum.tsx')

  it('takes a press, and leaves the tile under the rest of its box its own', () => {
    // `none` on the box excludes the whole subtree on native, so the cloud's press never fired.
    expect(album).not.toContain('pointerEvents="none"')
    expect(album).toMatch(
      /<XStack position="absolute"[^>]*pointerEvents="box-none">\s*<YStack[^>]*pointerEvents="box-none"/,
    )
  })

  it('sits over the tile that fetches', () => {
    expect(album).toContain('cellPlace(layout, fetchAt)')
  })
})
