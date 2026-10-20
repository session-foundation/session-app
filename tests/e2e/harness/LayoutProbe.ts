import type { ElementId } from '@session/test-ids'

/**
 * Reading which way a client lays itself out.
 *
 * Deliberately not part of `ISessionApp`, for the reason `IPerformanceProbe` gives: the document
 * and its viewport are Chromium's, reached through `page.evaluate`, and a device driver will need
 * its own way to answer the same questions.
 */
export interface ILayoutProbe {
  /** The `dir` attribute on the document element, which is what `applyDirection` writes. */
  documentDirection(): Promise<string>
  /** The vertical centre of the element's box, in window pixels. */
  verticalCentre(id: ElementId): Promise<number>
  /** Which half of the window the element's centre sits in. */
  horizontalHalf(id: ElementId): Promise<'left' | 'right'>
  /**
   * For every element with this id, whether any text in it is cut short: an ellipsis, or a box
   * with no width to draw into.
   */
  clipped(id: ElementId): Promise<boolean[]>
  /** For every element with this id, the direction its text is laid out in. */
  directions(id: ElementId): Promise<string[]>
  /**
   * Whether the first element's centre is left of the second's. Of two siblings, this is what
   * says whether the row holding them mirrored, which the window's halves cannot.
   */
  isLeftOf(first: ElementId, second: ElementId): Promise<boolean>
}
