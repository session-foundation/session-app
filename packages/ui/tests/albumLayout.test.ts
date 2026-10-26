import { describe, expect, it } from 'vitest'

import { ALBUM_MAX_TILES, ALBUM_SEAM, albumLayout, cellPlace, lastCell } from '#src/albumLayout'

/** A desktop bubble, and a phone one. Every shape has to hold at both. */
const WIDE = 420
const NARROW = 300

function sides(width: number, count: number): number[] {
  const l = albumLayout(count, width)
  return [...(l.lead === null ? [] : [l.lead.side]), ...l.rows.flat().map((c) => c.side)]
}

describe('an album’s shape', () => {
  it('draws one picture as a square the width of the bubble', () => {
    const l = albumLayout(1, WIDE)
    expect(l.lead?.side).toBe(WIDE)
    expect(l.height).toBe(WIDE)
    expect(l.rows).toEqual([])
  })

  it('draws two as halves', () => {
    expect(sides(WIDE, 2)).toEqual([208, 208])
    expect(albumLayout(2, WIDE).lead).toBeNull()
  })

  it('draws three as a big tile beside two stacked, which reach exactly its height', () => {
    const l = albumLayout(3, WIDE)
    const small = l.rows[0]?.[0]?.side ?? 0
    // The whole reason the smalls are a third of the width: two of them plus the seam are the big
    // one. A small off by a pixel leaves the right column shorter than the tile beside it.
    expect(small * 2 + ALBUM_SEAM).toBe(l.lead?.side)
    expect(l.height).toBe(l.lead?.side)
  })

  it('draws four as an even grid with no lead', () => {
    const l = albumLayout(4, WIDE)
    expect(l.lead).toBeNull()
    expect(l.rows).toHaveLength(2)
    expect(new Set(sides(WIDE, 4)).size).toBe(1)
  })

  it('draws five as a big square beside a 2x2, which stack to its height', () => {
    const l = albumLayout(5, WIDE)
    const small = l.rows[0]?.[0]?.side ?? 0
    expect(small * 2 + ALBUM_SEAM).toBe(l.lead?.side)
    expect(l.rows.flat()).toHaveLength(4)
  })

  it('splits five 50/50 and three two-thirds, which is forced rather than chosen', () => {
    // Square smalls that stack to the lead's height is what fixes each proportion. The three-up
    // stacks two of them, the five-up stacks two rows of two - so the lead cannot be the same
    // fraction in both, and the first picture leads by a different ratio at each count.
    const three = albumLayout(3, WIDE)
    const five = albumLayout(5, WIDE)
    expect((three.lead?.side ?? 0) / WIDE).toBeCloseTo(2 / 3, 1)
    expect((five.lead?.side ?? 0) / WIDE).toBeCloseTo(1 / 2, 1)
  })

  it('never draws more than the cap, and counts the rest', () => {
    const l = albumLayout(32, WIDE)
    expect([...(l.lead === null ? [] : [1]), ...l.rows.flat()].length).toBe(ALBUM_MAX_TILES)
    expect(l.overflow).toBe(32 - ALBUM_MAX_TILES)
  })

  it('puts the overflow on the last tile drawn', () => {
    // On the last, never the first small one: session-desktop puts it on the top-right tile,
    // which hides the wrong picture.
    const l = albumLayout(12, WIDE)
    expect(lastCell(l)?.at).toBe(ALBUM_MAX_TILES - 1)
  })

  it('counts nothing to overflow when it draws them all', () => {
    for (const count of [1, 2, 3, 4, 5]) expect(albumLayout(count, WIDE).overflow).toBe(0)
  })
})

describe('an album at a phone’s width', () => {
  it('keeps every shape, scaled', () => {
    for (const count of [1, 2, 3, 4, 5]) {
      const l = albumLayout(count, NARROW)
      expect(l.width).toBe(NARROW)
      // Nothing is bigger than the bubble it sits in, at any count.
      for (const side of sides(NARROW, count)) expect(side).toBeLessThanOrEqual(NARROW)
    }
  })

  it('never returns a tile with no size', () => {
    // A zero side draws nothing and looks like a missing picture rather than a layout bug.
    for (const width of [120, NARROW, WIDE]) {
      for (let count = 1; count <= 8; count += 1) {
        for (const side of sides(width, count)) expect(side).toBeGreaterThan(0)
      }
    }
  })
})

describe('where a cell sits', () => {
  it('places the three-up’s smalls beside the big tile, one under the other', () => {
    const l = albumLayout(3, WIDE)
    expect(cellPlace(l, 0)).toEqual({ side: 278, start: 0, top: 0 })
    expect(cellPlace(l, 1)).toEqual({ side: 137, start: 278 + ALBUM_SEAM, top: 0 })
    expect(cellPlace(l, 2)).toEqual({ side: 137, start: 278 + ALBUM_SEAM, top: 137 + ALBUM_SEAM })
  })

  it('places a grid’s cells by row and column', () => {
    const l = albumLayout(4, WIDE)
    expect(cellPlace(l, 3)).toEqual({ side: 208, start: 208 + ALBUM_SEAM, top: 208 + ALBUM_SEAM })
  })

  it('knows no place for an attachment the album does not draw', () => {
    expect(cellPlace(albumLayout(8, WIDE), 6)).toBeUndefined()
  })
})
