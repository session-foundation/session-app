import { useSyncExternalStore } from 'react'

/**
 * Tamagui's `onLayout` reports sizes from `offsetWidth` and `offsetHeight` rather than
 * `getBoundingClientRect`. The latter includes the page's CSS zoom -- at 200% an element 189 wide
 * reports 378 -- so a layout measured that way is off by the zoom. The offsets are in the
 * page's own units, which is also what `onLayout` means on a phone. (Its `x` and `y` still come
 * from the rect; nothing here reads them.)
 */
;(globalThis as { __TAMAGUI_ONLAYOUT_PRETRANSFORM?: boolean }).__TAMAGUI_ONLAYOUT_PRETRANSFORM =
  true

let zoom = 1
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Zooms the desktop app's content: a multiple of the default, which the person sets from the View
 * menu.
 *
 * **CSS `zoom` on the page root, not the browser's zoom.** The browser's zoom shrinks the CSS width
 * along with everything else, so a wide window at 200% read as a narrow one and drew the phone
 * layout. `zoom` scales what the page draws while media queries go on reading the window's real
 * width, so how many panes there are is decided by the window alone and zooming only makes the
 * content bigger.
 */
export function setPageZoom(next: number): void {
  if (next === zoom) return
  zoom = next
  document.documentElement.style.zoom = String(next)
  for (const listener of listeners) listener()
}

/** The current zoom, outside React: for a measurement taken in the window's pixels. */
export function currentPageZoom(): number {
  return zoom
}

/**
 * The current zoom, for a length that belongs to the window rather than to the content.
 *
 * Everything inside the page is scaled by the zoom, which is right for content. A pane's width is
 * the layout's, though, so it divides by this to stay the same share of the window at every zoom.
 */
export function usePageZoom(): number {
  return useSyncExternalStore(
    subscribe,
    () => zoom,
    () => 1,
  )
}
