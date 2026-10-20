import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The footer's row is what bounds the toggle's touch target.
 *
 * A `hitSlop` never reaches past the parent's bounds on iOS or Android, so a 48 target inside a
 * 30 row is a 30 target. Read from the source because nothing short of a device hit-tests it: the
 * arithmetic in `segmentedToggleLayout.test.ts` holds the slop, and this holds the row.
 */
describe('the attachment footer', () => {
  const source = readFileSync(join(import.meta.dirname, '../src/AttachmentFooter.tsx'), 'utf8')
  const row = source.slice(
    source.indexOf('<XStack'),
    source.indexOf('>\n', source.indexOf('<XStack')),
  )

  it('grows its row to the toggle’s target on touch, and gives the growth back as margin', () => {
    expect(source).toMatch(/ROW_HEIGHT = toggleRowHeight\(FOOTER_HEIGHT, SEGMENTED_TOGGLE_TARGET\)/)
    expect(row).toContain('height={ROW_HEIGHT}')
    expect(row).toContain('marginVertical={-ROW_OVERHANG}')
  })

  it('grows the verb to the row as well, rather than leaving it a caption-high target', () => {
    const verb = source.slice(source.lastIndexOf('<PressArea'), source.indexOf('</PressArea>'))
    expect(source).toMatch(/ACTION_SLOP = SEGMENTED_TOGGLE_TARGET \/ 2/)
    expect(verb).toContain('hitSlop={ACTION_SLOP}')
  })

  it('lets a touch on the overhang through to what is drawn under it', () => {
    expect(row).toContain('pointerEvents="box-none"')
  })

  // RN takes a touch in a parent's overflow, and the footer is the later sibling, so a tile, a row
  // or "Show all" left under the overhang would hand its tap to the footer's Download.
  it('has nothing drawn under its overhang in a message', () => {
    const message = readFileSync(join(import.meta.dirname, '../src/MessageAttachments.tsx'), 'utf8')
    expect(message).toMatch(/<YStack gap=\{SPACE_SCALE\['3xs'\] \+ ROW_OVERHANG\}/)
  })

  it('has nothing drawn under its overhang in the sheet', () => {
    const sheet = readFileSync(join(import.meta.dirname, '../src/AttachmentSheet.tsx'), 'utf8')
    expect(sheet).toMatch(/<YStack paddingTop=\{ROW_OVERHANG\}>\s*<AttachmentFooter /)
  })
})
