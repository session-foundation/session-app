import { describe, expect, it } from 'vitest'

import { bareFileName, MAX_SUGGESTED_NAME_CHARS, suggestedExportName } from '#src/exportFileName'

/**
 * The sender names an attachment, and that name ends up in a path on every platform. The step
 * both apps start from is that it names a file and nothing about where the file goes.
 */
describe("the bare name in a sender's suggestion", () => {
  it('keeps an ordinary name as it is', () => {
    expect(bareFileName('itinerary (final).pdf')).toBe('itinerary (final).pdf')
  })

  it('drops any directory part, whichever separator the sender used', () => {
    expect(bareFileName('../../.ssh/authorized_keys')).toBe('authorized_keys')
    expect(bareFileName('/etc/passwd')).toBe('passwd')
    expect(bareFileName('C:\\Windows\\x.dll')).toBe('x.dll')
    expect(bareFileName('..\\..\\startup/run.bat')).toBe('run.bat')
  })

  it('drops control characters', () => {
    expect(bareFileName('in\u0000voice\u001b[31m.pdf\u007f\n')).toBe('invoice[31m.pdf')
  })

  it('drops C1 and the controls that reorder text', () => {
    // Shown as `invoiceexe.pdf` while it would save as an executable.
    expect(bareFileName('invoice\u202efdp.exe')).toBe('invoicefdp.exe')
    expect(bareFileName('a\u2066b\u2069\u200e\u200f\u061c\u0085c.txt')).toBe('abc.txt')
  })

  it('leaves the caller to decide what stands in for nothing', () => {
    for (const nothing of ['', '   ', 'folder/', '\u0000\u0001', null, 42, undefined]) {
      expect(bareFileName(nothing)).toBe('')
    }
    expect(bareFileName('.')).toBe('.')
    expect(bareFileName('../..')).toBe('..')
  })
})

describe('the name an export is suggested under', () => {
  // Local time, as the name is: built from parts so the test holds in any time zone.
  const sentAtMs = new Date(2026, 9, 9, 14, 3, 5).getTime()
  const unnamed = (contentType: string | undefined, index = 0) =>
    suggestedExportName({ contentType, sentAtMs, index })

  it("keeps the sender's name when it has an extension, whatever the type says", () => {
    expect(
      suggestedExportName({
        filename: 'itinerary.pdf',
        contentType: 'image/png',
        sentAtMs,
        index: 0,
      }),
    ).toBe('itinerary.pdf')
  })

  it('names an unnamed attachment from when it was sent, with the extension its type calls for', () => {
    expect(unnamed('image/jpeg')).toBe('Session_2026-10-09-140305.jpg')
    expect(unnamed('audio/mpeg')).toBe('Session_2026-10-09-140305.mp3')
    expect(unnamed('application/pdf')).toBe('Session_2026-10-09-140305.pdf')
  })

  it('names two unnamed attachments of one message apart, and one sent a second later apart', () => {
    expect(unnamed('image/png', 2)).toBe('Session_2026-10-09-140305_3.png')
    expect(
      suggestedExportName({ contentType: 'image/png', sentAtMs: sentAtMs + 1000, index: 0 }),
    ).toBe('Session_2026-10-09-140306.png')
  })

  it('reads the type without its parameters or case', () => {
    expect(unnamed('Audio/MP4; codecs=mp4a.40.2')).toBe('Session_2026-10-09-140305.m4a')
  })

  it("takes a media type's own subtype as the extension when it is a plain one", () => {
    expect(unnamed('image/avif')).toBe('Session_2026-10-09-140305.avif')
    expect(unnamed('video/webm')).toBe('Session_2026-10-09-140305.webm')
  })

  it('gives no extension when the type calls for none', () => {
    for (const vague of [undefined, '', 'application/octet-stream', 'application/vnd.ms-excel']) {
      expect(unnamed(vague)).toBe('Session_2026-10-09-140305')
    }
  })

  it('treats a name that is nothing once made bare as no name', () => {
    for (const nothing of ['', '   ', 'folder/', '.', '..', '...']) {
      expect(
        suggestedExportName({ filename: nothing, contentType: 'audio/aac', sentAtMs, index: 0 }),
      ).toBe('Session_2026-10-09-140305.aac')
    }
  })

  it('replaces a name longer than either app will make one from', () => {
    const huge = `${'x'.repeat(MAX_SUGGESTED_NAME_CHARS)}.pdf`
    expect(
      suggestedExportName({ filename: huge, contentType: 'application/pdf', sentAtMs, index: 0 }),
    ).toBe('Session_2026-10-09-140305.pdf')
  })

  it('replaces a name the extension its type calls for would take past the limit', () => {
    const named = (filename: string) =>
      suggestedExportName({ filename, contentType: 'audio/mpeg', sentAtMs, index: 0 })
    const fits = 'x'.repeat(MAX_SUGGESTED_NAME_CHARS - '.mp3'.length)
    expect(named(fits)).toBe(`${fits}.mp3`)
    expect(named(`${fits}x`)).toBe('Session_2026-10-09-140305.mp3')
  })

  it('adds the extension the type calls for to a bare name that has none', () => {
    const named = (filename: string, contentType: string) =>
      suggestedExportName({ filename, contentType, sentAtMs, index: 0 })
    expect(named('voice note', 'audio/mpeg')).toBe('voice note.mp3')
    expect(named('Mr. Smith', 'text/plain')).toBe('Mr. Smith.txt')
    expect(named('../notes', 'text/plain')).toBe('notes.txt')
    expect(named('.profile', 'text/plain')).toBe('profile.txt')
    expect(named('README', 'application/octet-stream')).toBe('README')
  })
})
