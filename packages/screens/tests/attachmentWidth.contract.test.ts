import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * A message's attachments are drawn at one width, whichever shape they take.
 *
 * A bubble is as wide as what is in it. On native, a list left to size itself inside one gives its
 * flexible columns - the name, and the footer's total - no width at all, and both draw as an
 * ellipsis; a browser happens to lay the same tree out wider, so the desktop e2e run cannot see
 * it. Read from the source for that reason.
 */
describe('the attachments of a message', () => {
  const source = readFileSync(join(import.meta.dirname, '../src/MessageAttachments.tsx'), 'utf8')

  const root = source.slice(source.indexOf('return (\n'))

  it('take the album’s width in the list as well as the gallery', () => {
    expect(root).toMatch(/^return \(\n(\s*\/\/.*\n)*\s*<YStack[^>]*width=\{ALBUM_WIDTH\}/)
  })

  it('shrink to the bubble’s inside where the pane is too narrow for that width', () => {
    // The bubble is a share of the pane; below about 340 dp that share is less than the album
    // needs, and a fixed width would run out of the bubble rather than giving the list less.
    expect(root).toMatch(/^return \(\n(\s*\/\/.*\n)*\s*<YStack[^>]*maxWidth="100%"/)
  })
})
