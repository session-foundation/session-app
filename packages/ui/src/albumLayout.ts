/** The seam between tiles. Tight, so the set reads as one object rather than as loose squares. */
export const ALBUM_SEAM = 4

/** Past this the album stops drawing tiles and the last one carries the count. */
export const ALBUM_MAX_TILES = 5

export interface AlbumCell {
  /** Which attachment of the viewable set this is. */
  at: number
  side: number
}

export interface AlbumLayout {
  /**
   * The tile drawn beside everything else, where the shape has one.
   *
   * Null at two and four, which are plain grids with no first tile among equals.
   */
  lead: AlbumCell | null
  /** Beside the lead where there is one, and the whole album where there is not. */
  rows: AlbumCell[][]
  /** How many the album is not drawing. The last cell carries the count. 0 when it draws all. */
  overflow: number
  width: number
  height: number
}

/**
 * Where each tile of an album goes, for a given count and width.
 *
 * One shape per count rather than one expression covering all of them: the five have nothing in
 * common, and a formula spanning them reads worse than the table it would be standing in for.
 *
 * **Everything is a square.** `width` and `height` on an attachment are the sender's to supply and
 * are often absent, so an aspect-true layout needs an unknown-dimensions branch; a square needs
 * none, and the transcript's layout is then settled before a single byte or dimension is known.
 * Nothing moves when a picture lands, and the viewer shows it uncropped.
 */
export function albumLayout(count: number, width: number, seam = ALBUM_SEAM): AlbumLayout {
  const shown = Math.min(Math.max(count, 0), ALBUM_MAX_TILES)
  const overflow = Math.max(count - shown, 0)

  if (shown <= 1) {
    return ({ lead: { at: 0, side: width }, rows: [], overflow, width, height: width })
  }

  if (shown === 2) {
    const half = Math.floor((width - seam) / 2)
    return ({
      lead: null,
      rows: [[{ at: 0, side: half }, { at: 1, side: half }]],
      overflow,
      width,
      height: half,
    })
  }

  if (shown === 3) {
    // A big tile beside two stacked. The smalls are a third of the width, so that two of them plus
    // the seam are exactly the big one's height.
    const small = Math.floor((width - 2 * seam) / 3)
    const big = small * 2 + seam
    return ({
      lead: { at: 0, side: big },
      rows: [[{ at: 1, side: small }], [{ at: 2, side: small }]],
      overflow,
      width,
      height: big,
    })
  }

  if (shown === 4) {
    const half = Math.floor((width - seam) / 2)
    return ({
      lead: null,
      rows: [
        [{ at: 0, side: half }, { at: 1, side: half }],
        [{ at: 2, side: half }, { at: 3, side: half }],
      ],
      overflow,
      width,
      height: half * 2 + seam,
    })
  }

  // Five and up: a big square beside a 2x2. The split is 50/50 rather than the 2/3 the three-up
  // uses, and it is forced rather than chosen - two small squares plus a seam have to stack to the
  // big tile's height, which makes the right block exactly as wide as the big tile.
  const big = Math.floor((width - seam) / 2)
  const small = Math.floor((big - seam) / 2)
  return ({
    lead: { at: 0, side: big },
    rows: [
      [{ at: 1, side: small }, { at: 2, side: small }],
      [{ at: 3, side: small }, { at: 4, side: small }],
    ],
    overflow,
    width,
    height: big,
  })
}

/** The last tile drawn, which is the one the overflow count sits on. */
export function lastCell(layout: AlbumLayout): AlbumCell | undefined {
  const lastRow = layout.rows[layout.rows.length - 1]
  return lastRow?.[lastRow.length - 1] ?? layout.lead ?? undefined
}
