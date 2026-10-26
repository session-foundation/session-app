/**
 * Where a page sits in a horizontal paging scroll view.
 *
 * **Offsets count from the physical left on both iOS and Android, whatever the direction.** Laid
 * out right to left, the first page is at the right-hand end, so its offset is the largest, not 0.
 */
export function pageOffset(page: number, count: number, width: number, rtl: boolean): number {
  return (rtl ? count - 1 - page : page) * width
}

/**
 * The page a scroll offset has settled on, or null while it is between two - or past either end,
 * where iOS's bounce can rest on a whole page's width that is not a page.
 */
export function settledPage(
  offset: number,
  count: number,
  width: number,
  rtl: boolean,
): number | null {
  if (width === 0) return null
  const slot = Math.round(offset / width)
  if (Math.abs(offset - slot * width) >= 1 || slot < 0 || slot >= count) return null
  return rtl ? count - 1 - slot : slot
}
