/** A width and a height, in CSS px. */
export interface WindowSize {
  width: number
  height: number
}

/**
 * The window every page is laid out in. Wider than the catalog page's widest row, so no page wraps
 * on the window, and far past the `gtSm` breakpoint (701), so every story draws its wide layout.
 */
export const CAPTURE_WINDOW: WindowSize = { width: 3000, height: 2400 }

/**
 * The largest window a page may ask for. A capture paints only what lies inside the window, so a
 * page larger than this cannot be captured whole. `capture.sh` gives Xvfb a screen that holds it.
 */
export const MAX_CAPTURE_WINDOW: WindowSize = { width: 3600, height: 8000 }

/** Room around the largest window, in case anything is drawn past the page. */
const SCREEN_MARGIN = 200

/**
 * The X screen a capture's window sits on. capture.sh gives xvfb-run the same size, which a test
 * holds it to, and the spec gives each further shard a screen of this size.
 */
export const CAPTURE_SCREEN: WindowSize = {
  width: MAX_CAPTURE_WINDOW.width + SCREEN_MARGIN,
  height: MAX_CAPTURE_WINDOW.height + SCREEN_MARGIN,
}

/**
 * The window that holds a page reaching to `extent`: the capture window, grown on each side the
 * page passes. A width change can move a breakpoint and so the layout being measured, which is
 * why the width only grows when the page is already wider than the window.
 */
export function windowFor(
  extent: WindowSize,
  base: WindowSize = CAPTURE_WINDOW,
  max: WindowSize = MAX_CAPTURE_WINDOW,
): WindowSize {
  const size = {
    width: Math.max(base.width, Math.ceil(extent.width)),
    height: Math.max(base.height, Math.ceil(extent.height)),
  }
  if (size.width > max.width || size.height > max.height)
    throw new Error(
      `a catalog page reaches ${String(size.width)}x${String(size.height)} px, past the ` +
        `${String(max.width)}x${String(max.height)} capture window: split the story, or raise ` +
        'MAX_CAPTURE_WINDOW, and the Xvfb screen in capture.sh to match CAPTURE_SCREEN',
    )
  return size
}
