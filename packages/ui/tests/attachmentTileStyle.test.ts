import { RADII } from '@session/theme-tokens'
import { describe, expect, it } from 'vitest'

import {
  heldFailure,
  TILE_RADIUS_STEP,
  tileButtonName,
  tileFace,
  tilePlaceholder,
  tileRadius,
} from '#src/attachmentTileStyle'

describe('a tile’s corner', () => {
  it('takes the larger radius at the sizes an album draws', () => {
    // The five-up's quarters are about 100 at a desktop bubble's width and about 70 on a phone,
    // and the three-up's small tiles the same. All of them are the larger corner.
    expect(tileRadius(208)).toBe(RADII.md)
    expect(tileRadius(102)).toBe(RADII.md)
    expect(tileRadius(70)).toBe(RADII.md)
  })

  it('takes the smaller radius at the size a list draws', () => {
    // 12 on a 40 px square is most of its half-width, which reads as a squircle rather than as the
    // same tile drawn smaller.
    expect(tileRadius(40)).toBe(RADII.sm)
  })

  it('steps once, and at the boundary it names', () => {
    expect(tileRadius(TILE_RADIUS_STEP)).toBe(RADII.md)
    expect(tileRadius(TILE_RADIUS_STEP - 1)).toBe(RADII.sm)
    // Two steps and no more: three would stop the album's tiles and the list's thumbnails reading
    // as the same family, which is the whole reason there is one component.
    expect(new Set([tileRadius(1), tileRadius(40), tileRadius(64), tileRadius(400)]).size).toBe(2)
  })
})

describe('a tile’s placeholder', () => {
  it('is the sender’s preview where there is one', () => {
    expect(tilePlaceholder('session-media://preview/1/0', null)).toBe('session-media://preview/1/0')
  })

  it('is none without a preview, so the glyph is drawn', () => {
    expect(tilePlaceholder(undefined, null)).toBeNull()
    expect(tilePlaceholder(null, null)).toBeNull()
  })

  it('is none once that preview failed to load, so the tile is not left blank', () => {
    expect(tilePlaceholder('session-media://preview/1/0', 'session-media://preview/1/0')).toBeNull()
  })

  it('gives a new preview url its own attempt', () => {
    expect(tilePlaceholder('session-media://preview/2/0', 'session-media://preview/1/0')).toBe(
      'session-media://preview/2/0',
    )
  })
})

describe('a tile’s face', () => {
  const url = 'session-media://attachment/1/0'

  it('is pending with no url, and until the picture reports in', () => {
    expect(tileFace(undefined, null, null)).toBe('pending')
    expect(tileFace(null, null, null)).toBe('pending')
    expect(tileFace(url, null, null)).toBe('pending')
  })

  it('is the picture once it loaded', () => {
    expect(tileFace(url, url, null)).toBe('picture')
  })

  it('is failed once the picture could not be decoded, so it does not read as still downloading', () => {
    expect(tileFace(url, null, url)).toBe('failed')
  })

  it('starts over for a new url rather than inheriting the last one’s load or failure', () => {
    const next = 'session-media://attachment/2/0'
    expect(tileFace(next, url, null)).toBe('pending')
    expect(tileFace(next, null, url)).toBe('pending')
  })
})

describe('the failure a tile holds', () => {
  const url = 'session-media://attachment/1/0'

  it('holds it while the url is still handed over', () => {
    expect(heldFailure(url, url)).toBe(url)
  })

  it('forgets it once the url is withheld, so the retry of the same url starts over hidden', () => {
    expect(heldFailure(undefined, url)).toBeNull()
    expect(heldFailure(null, url)).toBeNull()
    expect(tileFace(url, null, heldFailure(undefined, url))).toBe('pending')
  })
})

describe('the name of a button holding a tile', () => {
  it('is its own name while the tile is not failed', () => {
    expect(tileButtonName('photo.jpg', 'Unable to open file', false)).toBe('photo.jpg')
    expect(tileButtonName(undefined, 'Unable to open file', false)).toBeUndefined()
  })

  it('says the tile failed, after the name where there is one', () => {
    expect(tileButtonName('photo.jpg', 'Unable to open file', true)).toBe(
      'photo.jpg, Unable to open file',
    )
    expect(tileButtonName(undefined, 'Unable to open file', true)).toBe('Unable to open file')
  })
})
