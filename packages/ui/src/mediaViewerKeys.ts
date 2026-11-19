/**
 * The index an arrow key pages the viewer to, or null when the key is not one of the viewer's or
 * there is nothing further that way.
 *
 * The keys follow the chevrons on screen, not the index: in a right-to-left layout the previous
 * chevron is on the right, so ArrowRight steps back. Like the chevrons, they stop at the ends.
 */
export function mediaViewerKeyIndex(
  key: string,
  { index, count, rtl }: { index: number; count: number; rtl: boolean },
): number | null {
  const towardStart = rtl ? 'ArrowRight' : 'ArrowLeft'
  const towardEnd = rtl ? 'ArrowLeft' : 'ArrowRight'
  const next = key === towardStart ? index - 1 : key === towardEnd ? index + 1 : null
  if (next === null || next < 0 || next >= count) return null
  return next
}
