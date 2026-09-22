import { describe, expect, it } from 'vitest'

import { fileFormat, fileGlyph, MAX_EXTENSION, splitFilename } from '#src/attachmentFile'

describe('a filename split into two runs', () => {
  it('keeps the extension on the tail, where nothing can truncate it', () => {
    const { head, tail } = splitFilename('quarterly-itinerary-final-v4-approved.pdf')
    expect(head + tail).toBe('quarterly-itinerary-final-v4-approved.pdf')
    expect(tail).toBe('roved.pdf')
  })

  it('keeps enough of the stem to tell two runs of one report apart', () => {
    // The whole point of the tail: these two differ in the last two characters of the stem, which
    // is exactly what a head-and-extension shortening throws away.
    const a = splitFilename('board-pack-appendix-report-2026-01.pdf')
    const b = splitFilename('board-pack-appendix-report-2026-02.pdf')
    expect(a.tail).not.toBe(b.tail)
  })

  it('loses nothing, at any length', () => {
    for (const name of ['a', 'a.b', '.hidden', 'no-extension', 'x'.repeat(200) + '.tar.gz']) {
      const { head, tail } = splitFilename(name)
      expect(head + tail).toBe(name)
    }
  })

  it('puts a short name entirely on the tail rather than cutting it', () => {
    expect(splitFilename('cv.pdf')).toEqual({ head: '', tail: 'cv.pdf' })
  })

  it('treats a dotted middle as part of the stem', () => {
    // `.gz` is the extension and `.tar` is not, which is what a suffix length cap buys: the
    // alternative is either a list of every double extension or `archive` losing `.tar.gz`.
    expect(splitFilename('archive.tar.gz').tail).toBe('e.tar.gz')
  })

  it('refuses a suffix too long to be an extension', () => {
    // A dot in the middle of a sentence-shaped name is not an extension, and treating it as one
    // pins a run of prose to the un-truncatable end of the row.
    const name = `notes.${'x'.repeat(MAX_EXTENSION)}`
    expect(fileFormat(name)).toBe('')
  })

  it('leaves a leading dot alone', () => {
    // `.hidden` is a name, not an extension of nothing.
    expect(fileFormat('.hidden')).toBe('')
  })
})

describe('the format under the glyph', () => {
  it('is the extension, upper case', () => {
    expect(fileFormat('report.pdf')).toBe('PDF')
    expect(fileFormat('sheet.XLSX')).toBe('XLSX')
  })

  it('is empty where the name does not say', () => {
    expect(fileFormat('no-extension')).toBe('')
  })

  it('never grows the lead column', () => {
    // The column is sized for four characters; a longer suffix is still a valid extension by the
    // length cap, and left whole it would set the width of every row beside it.
    expect(fileFormat('photo.jpeg2000')).toHaveLength(4)
  })
})

describe('which glyph names a file', () => {
  it('reads the extension before the declared type', () => {
    // `application/octet-stream` is what a great many senders declare.
    expect(fileGlyph('deck.pdf', 'application/octet-stream')).toBe('fileText')
    // And a declared family can be less specific than the name: text/csv is a spreadsheet.
    expect(fileGlyph('rows.csv', 'text/csv')).toBe('fileSpreadsheet')
  })

  it('falls back to the declared family when the name has no extension', () => {
    expect(fileGlyph('recording', 'audio/aac')).toBe('fileAudio')
    expect(fileGlyph('clip', 'video/mp4')).toBe('fileVideo')
  })

  it('ends at the generic file when neither says anything', () => {
    expect(fileGlyph('attachment')).toBe('file')
    expect(fileGlyph('attachment', 'application/x-thing')).toBe('file')
  })

  it('ignores the case of both', () => {
    expect(fileGlyph('ARCHIVE.ZIP')).toBe('fileArchive')
    expect(fileGlyph('recording', 'AUDIO/AAC')).toBe('fileAudio')
  })
})
