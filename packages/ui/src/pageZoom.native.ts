/**
 * Nothing to do on a phone or tablet: their content grows with the system text size instead, which
 * never changes the layout. See the desktop version.
 */
export function setPageZoom(_next: number): void {
  // A phone has no page to zoom.
}

/** Always 1: nothing on a phone or tablet zooms the page. */
export function currentPageZoom(): number {
  return 1
}

/** Always 1: nothing on a phone or tablet zooms the page. */
export function usePageZoom(): number {
  return 1
}
