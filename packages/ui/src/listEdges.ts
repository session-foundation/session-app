/** What a list's scroller last said, and the content height its offset was read against. */
export interface ScrollReading {
  offsetPx: number
  viewportPx: number
  contentPx: number
  /** The content height of the scroll event that gave `offsetPx`. */
  offsetAtContentPx: number
}

/**
 * Whether the first row is within `viewports` list heights of the top, or null when the offset
 * cannot say. Rows added above move the scroll only once they are laid out, and an offset read
 * before then is still where the reader was in the rows before them: taken as is, it is at the
 * start again, and asks for page after page while the first is still arriving.
 */
export function nearStart(reading: ScrollReading, viewports: number): boolean | null {
  const { offsetPx, viewportPx, contentPx, offsetAtContentPx } = reading
  // Content no taller than the list has nowhere to scroll, so no event to wait for.
  if (offsetAtContentPx !== contentPx && contentPx > viewportPx) return null
  return offsetPx <= viewportPx * viewports
}
