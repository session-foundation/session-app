/** The smallest a fitted line goes, as a share of its size, before it truncates instead. */
export const MIN_FIT_SCALE = 0.5

/**
 * Taken off the box before fitting. The widths are whole pixels and text is not, so a line fitted
 * to the exact box can land a fraction over it and still be cut off with an ellipsis.
 */
const FIT_SLACK_PX = 1

/**
 * The font size that fits a line of `contentWidth` into `boxWidth`, or null when it already fits.
 * Never below `MIN_FIT_SCALE` of the full size: past that the line truncates.
 */
export function fittedFontSize(
  fullSize: number,
  boxWidth: number,
  contentWidth: number,
): number | null {
  if (boxWidth <= 0 || contentWidth <= boxWidth) return null
  return fullSize * Math.max(MIN_FIT_SCALE, (boxWidth - FIT_SLACK_PX) / contentWidth)
}
