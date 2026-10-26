export type MediaKind = 'image' | 'video'

/**
 * The image types every renderer draws inline. SVG is deliberately out: it is a script-capable
 * document rather than a bitmap, and native image views do not draw it. `image/jpg` is not a
 * registered type, but senders send it.
 */
const VIEWABLE_IMAGE: ReadonlySet<string> = new Set([
  'image/bmp',
  'image/gif',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/apng',
  'image/webp',
])

const VIEWABLE_VIDEO: ReadonlySet<string> = new Set(['video/mp4', 'video/webm', 'video/ogg'])

// Space, tab, CR and LF alone, as the shim trims: trim() would also take \f, \v and a BOM.
const EDGE_SPACE = /^[ \t\r\n]+|[ \t\r\n]+$/g

/**
 * `Image/JPEG; charset=binary` → `image/jpeg`: a declared type is compared by its essence only,
 * which ends at a `;` and folds ASCII case alone. An embedded NUL is kept, so it matches no list.
 */
export function contentTypeEssence(contentType: string | undefined): string | undefined {
  return contentType
    ?.split(';')[0]
    ?.replace(EDGE_SPACE, '')
    .replace(/[A-Z]/g, (c) => c.toLowerCase())
}

/**
 * libsession's `image::is_displayable_image`: what it shows as a gallery, what `image-attachments`
 * fetches unasked, and what it makes a thumbnail of. Its list, compared by essence as
 * `contentTypeEssence` reads one.
 */
const DISPLAYABLE_IMAGE: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/jpg',
  'image/pjpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
])

export function isDisplayableImage(contentType: string | undefined): boolean {
  const type = contentTypeEssence(contentType)
  return type !== undefined && DISPLAYABLE_IMAGE.has(type)
}

export function isViewableImage(contentType: string | undefined): boolean {
  const type = contentTypeEssence(contentType)
  return type !== undefined && VIEWABLE_IMAGE.has(type)
}

export function isViewableVideo(contentType: string | undefined): boolean {
  const type = contentTypeEssence(contentType)
  return type !== undefined && VIEWABLE_VIDEO.has(type)
}

export function isViewableContentType(contentType: string | undefined): boolean {
  return isViewableImage(contentType) || isViewableVideo(contentType)
}

/** Only meaningful for a viewable type, which a caller checks first. */
export function mediaKindOf(contentType: string | undefined): MediaKind {
  return isViewableVideo(contentType) ? 'video' : 'image'
}

/**
 * How wide a message's attachments are drawn, in density-independent pixels: as wide as a bubble
 * is allowed to be. Here rather than with the screens because each app also asks libsession for
 * thumbnails this wide, times its display density, before anything is drawn.
 *
 * A number and not a constant shared with the bubble, because the bubble's own width is a
 * percentage of the pane and nothing measures it yet. When something does, the album takes it as
 * a prop - the album has never been the thing that decides how wide a message is.
 */
export const ALBUM_WIDTH = 240

/**
 * The edge to make thumbnails at for the densest of these displays. 1 with none connected, since
 * thumbnails are never remade and a headless start would otherwise ask for an edge of -Infinity.
 */
export function thumbnailEdgePxFor(scaleFactors: readonly number[]): number {
  return Math.round(ALBUM_WIDTH * Math.max(1, ...scaleFactors))
}
