import { RADII } from '@session/theme-tokens'
import { describe, expect, it } from 'vitest'

import {
  showsPicture,
  TILE_RADIUS_STEP,
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
  it('is the sender’s thumbhash where there is one', () => {
    expect(tilePlaceholder('session-media://thumbhash/1/0', null)).toBe(
      'session-media://thumbhash/1/0',
    )
  })

  it('is none without a thumbhash, so the glyph is drawn', () => {
    expect(tilePlaceholder(undefined, null)).toBeNull()
    expect(tilePlaceholder(null, null)).toBeNull()
  })

  it('is none once that thumbhash failed to load, so the tile is not left blank', () => {
    expect(
      tilePlaceholder('session-media://thumbhash/1/0', 'session-media://thumbhash/1/0'),
    ).toBeNull()
  })

  it('gives a new thumbhash url its own attempt', () => {
    expect(tilePlaceholder('session-media://thumbhash/2/0', 'session-media://thumbhash/1/0')).toBe(
      'session-media://thumbhash/2/0',
    )
  })
})

describe('whether a tile shows its picture', () => {
  const url = 'session-media://thumbnail/1/0'

  it('does not with no url, and not until the picture reports in', () => {
    expect(showsPicture(undefined, null)).toBe(false)
    expect(showsPicture(null, null)).toBe(false)
    expect(showsPicture(url, null)).toBe(false)
  })

  it('does once it loaded', () => {
    expect(showsPicture(url, url)).toBe(true)
  })

  it('starts over for a new url rather than inheriting the last one’s load', () => {
    expect(showsPicture('session-media://thumbnail/2/0', url)).toBe(false)
  })
})
