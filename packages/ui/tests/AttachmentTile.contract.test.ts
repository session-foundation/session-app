import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * What the tile wires on its picture, held by reading the source: `packages/ui` has no renderer
 * to mount it in, and the failure is a tile that sits on its placeholder for ever.
 */
const tile = readFileSync(join(import.meta.dirname, '../src/AttachmentTile.tsx'), 'utf8')

/** The props of the `<Image` whose `uri` is the picture's, up to its closing `/>`. */
function pictureImage(): string {
  const start = tile.indexOf('<Image\n            uri={uri}')
  expect(start).toBeGreaterThanOrEqual(0)
  return tile.slice(start, tile.indexOf('/>', start))
}

describe('an attachment tile’s picture', () => {
  it('reports both that it landed and that it failed', () => {
    const image = pictureImage()
    expect(image).toContain('onLoad=')
    expect(image).toContain('onError=')
  })

  it('keeps its url when it fails, so a retry is a new attempt and not a withheld one', () => {
    expect(tile).toMatch(/setFailedUri\(uri\)/)
    expect(pictureImage()).not.toMatch(/failed/)
  })
})

describe('an attachment tile’s failed face', () => {
  // Pending and failed differ only by a glyph, so without these an e2e test cannot tell them apart
  // and a screen reader hears nothing.
  it('names and addresses the mark over a placeholder', () => {
    const mark = tile.slice(
      tile.indexOf('function FailedMark'),
      tile.indexOf('function VideoAffordances'),
    )
    expect(mark).toMatch(/role="img"\s+aria-label=\{failedLabel\}\s+testID=\{failedTestID\}/)
    expect(tile).toMatch(
      /<FailedMark side=\{side\} failedLabel=\{failedLabel\} failedTestID=\{failedTestID\} \/>/,
    )
  })

  it('names and addresses the glyph on a flat tile, only while it is the failed one', () => {
    expect(tile).toContain(
      "{...(failed ? { role: 'img', 'aria-label': failedLabel, testID: failedTestID } : {})}",
    )
  })

  it('is handed its label and id by the album and the file row', () => {
    const read = (file: string) => readFileSync(join(import.meta.dirname, '../src', file), 'utf8')
    const album = read('AttachmentAlbum.tsx')
    expect(
      album.match(/failedLabel=\{failedLabel\}\s+failedTestID=\{failedTestID\}/g),
    ).toHaveLength(3)
    expect(read('FileRow.tsx')).toMatch(
      /failedLabel=\{thumbnail\.failedLabel\}\s+failedTestID=\{testIDs\?\.thumbnailFailed\}/,
    )
  })

  // A named button's contents are not announced, so the mark inside it goes unheard on its own.
  it('puts its failed words in the name of the button that holds it', () => {
    const read = (file: string) => readFileSync(join(import.meta.dirname, '../src', file), 'utf8')
    expect(tile).toMatch(/onFailedChange\?\.\(failed\)/)
    const album = read('AttachmentAlbum.tsx')
    expect(album).toContain('onFailedChange={setFailed}')
    expect(album).toContain('tileButtonName(undefined, failedLabel, failed)')
    expect(album).toMatch(
      /role="button"\s+\{\.\.\.\(name === undefined \? \{\} : \{ 'aria-label': name \}\)\}/,
    )
    const row = read('FileRow.tsx')
    expect(row).toContain('onFailedChange={setThumbnailFailed}')
    expect(row).toContain('tileButtonName(filename, thumbnail.failedLabel, thumbnailFailed)')
  })
})
