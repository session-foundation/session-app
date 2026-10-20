import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Both places a tile is drawn give its failed face the same id and the same words, read from the
 * source because nothing in the unit tier renders a tile.
 */
describe('an attachment that did not decode', () => {
  const read = (file: string) => readFileSync(join(import.meta.dirname, '../src', file), 'utf8')

  it('is addressed and announced in the album', () => {
    const album = read('MessageAlbum.tsx')
    expect(album).toContain("failedLabel={tr('attachmentsErrorOpen')}")
    expect(album).toContain('failedTestID={ELEMENT.conversation.attachmentFailed}')
  })

  it('is addressed and announced in the list', () => {
    const row = read('AttachmentRow.tsx')
    expect(row).toContain("failedLabel: tr('attachmentsErrorOpen')")
    expect(row).toContain('thumbnailFailed: ELEMENT.conversation.attachmentFailed')
  })
})
