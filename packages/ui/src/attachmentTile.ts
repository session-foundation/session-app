import { RADII, SPACING } from '@session/theme-tokens'

/**
 * Where a tile stops taking the larger corner.
 *
 * A rounded square is one shape at every size, but not one radius: 12 on a 40 px thumbnail is
 * most of its half-width, so it reads as a squircle rather than as the same tile drawn smaller.
 * Two steps is enough, and a step means the album's small tiles and the list's thumbnails are
 * visibly the same family.
 */
export const TILE_RADIUS_STEP = 64

/** The corner an attachment tile takes at a given side length. */
export function tileRadius(side: number): number {
  return side >= TILE_RADIUS_STEP ? RADII.md : RADII.sm
}

/**
 * What a control sits on when it sits on a photograph.
 *
 * Not a theme token, and deliberately: it is drawn over somebody's picture, and the picture is
 * whatever they sent. A scrim that followed the theme would be lighter on a light theme, which is
 * the wrong direction for something whose job is to separate a glyph from an image.
 */
export const TILE_SCRIM = 'rgba(0, 0, 0, 0.55)'

/**
 * The hairline round a tile with no picture in it yet.
 *
 * `backgroundTertiary` on `backgroundPrimary` is about 1.06:1 in a light theme, and the album is
 * drawn edge to edge with no bubble behind it to supply an edge. Inset rather than a border so it
 * costs no layout, and **on the tile rather than on whatever fills it**: a ring on an inner
 * element is square, and the tile's own clip then takes its corners off instead of curving them.
 */
export const TILE_HAIRLINE_WIDTH = 1

/**
 * How far the duration badge sits from the tile's bottom and leading edges.
 *
 * `$2xs`, as a number because `logical()` takes lengths rather than tokens - the inline inset has
 * to be written as a CSS logical property or it does not mirror, which is what that helper is for.
 */
export const TILE_BADGE_INSET = SPACING['2xs']
