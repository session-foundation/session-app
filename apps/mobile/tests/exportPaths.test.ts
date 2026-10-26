import { utf8Encode } from '@session/basic-types'
import { describe, expect, it } from 'vitest'

import {
  exportFileName,
  isMediaStoreMedia,
  numberedName,
  partName,
  photoLibraryExtension,
  photoLibraryTakes,
  placeUnderFreeName,
  stagedPath,
  StagedExports,
  stagingTokenOf,
} from '#src/exportPaths'

const ROOT = '/data/user/0/org.getsession.session2/cache/session-exports'
const TOKEN = '3f2c1b9a-7d4e-4c55-9f10-2a6b8e0d4c11'

/**
 * The sender names the file, and `save_attachment` writes wherever the path says. Everything here
 * is about that name never choosing the directory.
 */
describe('the name an export is written under', () => {
  it('keeps an ordinary name', () => {
    expect(exportFileName('itinerary.pdf')).toBe('itinerary.pdf')
  })

  it('is the bare name, as every platform starts from', () => {
    expect(exportFileName('../../files/session/mainnet/session.db')).toBe('session.db')
    expect(exportFileName('invoice\u202efdp.exe')).toBe('invoicefdp.exe')
  })

  it('falls back to a plain name when nothing usable is left', () => {
    for (const nothing of ['', '..', '.', '/', 'a/', '   ', '\u0000', null, undefined, 42]) {
      expect(exportFileName(nothing)).toBe('attachment')
    }
  })

  it('strips leading dots', () => {
    expect(exportFileName('.hidden.pdf')).toBe('hidden.pdf')
  })

  it('gives a picture for the photo library the extension its type calls for', () => {
    expect(exportFileName('holiday.exe', 'image/jpeg')).toBe('holiday.jpg')
    expect(exportFileName('clip', 'video/mp4; codecs=avc1')).toBe('clip.mp4')
    expect(exportFileName('report.pdf', 'application/pdf')).toBe('report.pdf')
  })

  it('is bounded in bytes, keeping its extension', () => {
    const long = `${'中'.repeat(150)}.pdf`
    const name = exportFileName(long)
    expect(utf8Encode(name).length).toBeLessThanOrEqual(200)
    expect(name.endsWith('.pdf')).toBe(true)
  })

  it('is bounded when the extension alone is longer than the bound', () => {
    for (const long of [`a.${'x'.repeat(250)}`, `report.${'中'.repeat(240)}`]) {
      expect(utf8Encode(exportFileName(long)).length).toBeLessThanOrEqual(200)
    }
    expect(exportFileName(`a.${'x'.repeat(250)}`, 'image/jpeg').endsWith('.jpg')).toBe(true)
  })

  it('falls back, as desktop does, for a suggestion longer than any file system takes', () => {
    const huge = `${'é'.repeat(100_000)}.pdf`
    const started = performance.now()
    expect(exportFileName(huge)).toBe('attachment')
    expect(exportFileName(huge, 'image/png')).toBe('attachment.png')
    expect(performance.now() - started).toBeLessThan(100)
    expect(exportFileName(`${'x'.repeat(251)}.pdf`)).toBe(`${'x'.repeat(196)}.pdf`)
  })
})

describe('which files go to the photo library', () => {
  it('takes the pictures and videos a library can file', () => {
    expect(photoLibraryExtension('image/png')).toBe('png')
    expect(photoLibraryExtension('Image/JPEG')).toBe('jpg')
    expect(photoLibraryExtension('video/quicktime')).toBe('mov')
  })

  it('sends everything else to a folder', () => {
    for (const type of [
      'application/pdf',
      'video/webm',
      'image/svg+xml',
      'audio/mpeg',
      undefined,
    ]) {
      expect(photoLibraryExtension(type)).toBeNull()
    }
  })
})

describe('what Android files in a media collection', () => {
  it('is what the photo library takes, and any sound', () => {
    expect(isMediaStoreMedia('image/png')).toBe(true)
    expect(isMediaStoreMedia('video/3gpp')).toBe(true)
    expect(isMediaStoreMedia('audio/mpeg')).toBe(true)
  })

  it('leaves everything else to Downloads', () => {
    for (const type of ['application/pdf', 'video/webm', 'image/svg+xml', undefined]) {
      expect(isMediaStoreMedia(type)).toBe(false)
    }
  })
})

describe("which platform's photo library takes a type", () => {
  it('sends a 3GPP video to a folder on iOS, whose Photos refuses it', () => {
    expect(photoLibraryTakes('video/3gpp', 'ios')).toBe(false)
    expect(photoLibraryTakes('video/3gpp', 'android')).toBe(true)
  })

  it('takes the other library types on both', () => {
    for (const os of ['ios', 'android'] as const) {
      expect(photoLibraryTakes('image/webp', os)).toBe(true)
      expect(photoLibraryTakes('Video/MP4; codecs=avc1', os)).toBe(true)
      expect(photoLibraryTakes('application/pdf', os)).toBe(false)
    }
  })
})

describe('a path handed to exportAttachment or back to the port', () => {
  const pending = new Set([TOKEN])

  it('is accepted in a staging folder still pending, under the name a collision produced too', () => {
    const path = stagedPath(ROOT, TOKEN, 'itinerary.pdf')
    expect(stagingTokenOf(path, ROOT, pending)).toBe(TOKEN)
    expect(stagingTokenOf(`${ROOT}/${TOKEN}/itinerary (1).pdf`, ROOT, pending)).toBe(TOKEN)
  })

  it('is refused once delivered, or in a folder this run never made', () => {
    expect(stagingTokenOf(stagedPath(ROOT, TOKEN, 'x.pdf'), ROOT, new Set())).toBeNull()
    const other = '0badc0de-0000-4000-8000-000000000000'
    expect(stagingTokenOf(`${ROOT}/${other}/x.pdf`, ROOT, pending)).toBeNull()
  })

  it('is refused outside the staging root', () => {
    expect(
      stagingTokenOf('/data/user/0/org.getsession.session2/files/session.db', ROOT, pending),
    ).toBeNull()
    expect(stagingTokenOf(`${ROOT}-old/${TOKEN}/x.pdf`, ROOT, pending)).toBeNull()
    expect(stagingTokenOf(`${ROOT}/x.pdf`, ROOT, pending)).toBeNull()
  })

  it('is refused when it climbs or nests', () => {
    expect(stagingTokenOf(`${ROOT}/${TOKEN}/../../files/session.db`, ROOT, pending)).toBeNull()
    expect(stagingTokenOf(`${ROOT}/${TOKEN}/..`, ROOT, pending)).toBeNull()
    expect(stagingTokenOf(`${ROOT}/${TOKEN}/nested/x.pdf`, ROOT, pending)).toBeNull()
    expect(stagingTokenOf(`${ROOT}/${TOKEN}/`, ROOT, pending)).toBeNull()
  })

  it('is refused when it is not a path at all', () => {
    for (const nonsense of ['', null, undefined, 42, {}]) {
      expect(stagingTokenOf(nonsense, ROOT, pending)).toBeNull()
    }
  })

  it('never builds a staging path from a token that could be one', () => {
    expect(() => stagedPath(ROOT, '../files', 'x')).toThrow()
    expect(() => stagedPath(ROOT, '', 'x')).toThrow()
  })
})

describe('a staging token', () => {
  const path = stagedPath(ROOT, TOKEN, 'itinerary.pdf')

  it('admits the one write it was handed out for, and the port takes where it landed', () => {
    const staged = new StagedExports<string>(ROOT)
    staged.stage(TOKEN, 'photos')
    expect(staged.admit(path)).toBe(true)
    expect(staged.deliver(`${ROOT}/${TOKEN}/itinerary (1).pdf`)).toEqual({
      token: TOKEN,
      delivery: 'photos',
    })
  })

  it('is spent by that write: a second to the same folder is refused', () => {
    const staged = new StagedExports<string>(ROOT)
    staged.stage(TOKEN, 'photos')
    expect(staged.admit(path)).toBe(true)
    expect(staged.admit(path)).toBe(false)
    expect(staged.admit(stagedPath(ROOT, TOKEN, 'other.pdf'))).toBe(false)
  })

  it('gives the port nothing that was only staged, or already delivered', () => {
    const staged = new StagedExports<string>(ROOT)
    staged.stage(TOKEN, 'photos')
    expect(staged.deliver(path)).toBeNull()
    staged.admit(path)
    expect(staged.deliver(path)).not.toBeNull()
    expect(staged.deliver(path)).toBeNull()
  })

  it('admits nothing it never handed out', () => {
    const staged = new StagedExports<string>(ROOT)
    expect(staged.admit(path)).toBe(false)
    expect(staged.admit(`${ROOT}/${TOKEN}/../../files/session.db`)).toBe(false)
  })
})

describe('a name in a folder that already holds it', () => {
  it('is numbered the way libsession numbers a collision', () => {
    expect(numberedName('itinerary.pdf', 0)).toBe('itinerary.pdf')
    expect(numberedName('itinerary.pdf', 1)).toBe('itinerary (1).pdf')
    expect(numberedName('itinerary.pdf', 2)).toBe('itinerary (2).pdf')
    expect(numberedName('notes', 1)).toBe('notes (1)')
  })

  it('is written first under a temporary name libsession would use, numbered when taken', () => {
    expect(partName('report.pdf', 0)).toBe('report.pdf.sessiondl')
    expect(partName('report.pdf', 1)).toBe('report.pdf.sessiondl1')
  })

  it('is found by attempting each name in turn', async () => {
    const held = new Set(['itinerary.pdf', 'itinerary (1).pdf'])
    const tried: string[] = []
    await placeUnderFreeName(
      'itinerary.pdf',
      (candidate) => {
        tried.push(candidate)
        if (held.has(candidate)) throw new Error('taken')
      },
      (error) => error instanceof Error && error.message === 'taken',
    )
    expect(tried).toEqual(['itinerary.pdf', 'itinerary (1).pdf', 'itinerary (2).pdf'])
  })

  it('steps through whichever naming it is given', async () => {
    const tried: string[] = []
    await placeUnderFreeName(
      'x.pdf',
      (candidate) => {
        tried.push(candidate)
        if (tried.length < 3) throw new Error('taken')
      },
      () => true,
      partName,
    )
    expect(tried).toEqual(['x.pdf.sessiondl', 'x.pdf.sessiondl1', 'x.pdf.sessiondl2'])
  })

  it('passes any other failure straight through', async () => {
    const revoked = new Error('revoked')
    await expect(
      placeUnderFreeName(
        'x.pdf',
        () => {
          throw revoked
        },
        () => false,
      ),
    ).rejects.toBe(revoked)
  })

  it('gives up after a thousand collisions', async () => {
    let tries = 0
    await expect(
      placeUnderFreeName(
        'x.pdf',
        () => {
          tries += 1
          throw new Error('taken')
        },
        () => true,
      ),
    ).rejects.toThrow('taken')
    expect(tries).toBe(1001)
  })
})
