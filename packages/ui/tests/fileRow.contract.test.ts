import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * What `FileRow` draws that a list and a mirrored layout depend on, held by reading the source:
 * `packages/ui` renders nothing in its unit tier, and neither shows in a browser in English.
 */
describe('a file row', () => {
  const row = readFileSync(join(import.meta.dirname, '../src/FileRow.tsx'), 'utf8')

  it('holds the lead at the height fileRowHeight counts, with the padding it counts', () => {
    // `getItemLayout` places rows by that constant, so a row that measured differently would
    // scroll to the wrong place.
    expect(row).toMatch(
      /<YStack\s+width=\{FILE_LEAD_WIDTH\}\s+height=\{fileLeadHeight\(fontScale\)\}/,
    )
    expect(row).toMatch(
      /<XStack\s+alignItems="center"\s+gap=\{FILE_ROW_GAP\}\s+paddingVertical="\$xs"/,
    )
  })

  it('takes its direction from the name’s own script, on the name and caption together', () => {
    // Pinned to the layout, an Arabic name read tail-first in one direction or the other.
    expect(row).toContain('direction: nameDirection(filename)')
    expect(row).toMatch(/<YStack flex=\{1\} minWidth=\{0\} gap="\$3xs" style=\{direction\}>/)
    expect(row).not.toContain("direction: 'ltr'")
    expect(row).toMatch(
      /<Text[^>]*alignSelf="flex-start"[^>]*style=\{CAPTION_BIDI\}[^>]*testID=\{testIDs\?\.caption\}/,
    )
    // The caption is the app's copy: under an Arabic name, "52.5 kB" would read "kB 52.5".
    expect(row).toContain("unicodeBidi: 'plaintext'")
  })
})
