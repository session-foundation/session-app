import { PENDING_COPY } from './pendingCopy'

/**
 * What a screen reader calls one picture in an album: its filename, or else where it sits among
 * the album's pictures, counted from 1 and over every one of them, the tiles behind "+N" included.
 */
export function albumTileName(filename: string | undefined, at: number, count: number): string {
  return filename ?? PENDING_COPY.attachmentImagePosition(at + 1, count)
}
