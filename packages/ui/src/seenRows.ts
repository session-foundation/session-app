/** What the list knows about which of its rows are on screen. */
export interface RowVisibility {
  /** Indexes of the rows with any part on screen, in any order. */
  visible: readonly number[]
  /** Indexes of the rows wholly on screen. */
  whole: ReadonlySet<number>
  /** Whether the list is scrolled to its end, so nothing is cut off below the last row. */
  atEnd: boolean
}

/**
 * The rows whose bottom edge is on screen, in index order: the rows that have been seen.
 *
 * Only the first and last visible rows can be cut off. The first is cut at its top, so its bottom
 * is showing; the last is cut at its bottom, so it counts only once it is whole on screen or
 * nothing follows it. A bottom edge rather than the whole row, because a message taller than the
 * screen is never whole on it, and reaching its bottom is what reading it to the end means.
 */
export function seenRows({ visible, whole, atEnd }: RowVisibility): number[] {
  const sorted = [...visible].sort((a, b) => a - b)
  const last = sorted.at(-1)
  if (last === undefined) return []
  if (atEnd || whole.has(last)) return sorted
  return sorted.slice(0, -1)
}
