import type { RefObject } from 'react'

import type { ScrollReading } from './listEdges'

/** The first and last rows drawn inside the viewport, as last reported. */
export type RowsOnScreen = { first: number; last: number } | null

/** What the platform's way of scrolling a transcript to a row is given. */
export interface RowScrollerInput {
  /** The FlatList, or null before it is drawn. */
  list: RefObject<unknown>
  scroll: RefObject<ScrollReading>
  /** Each drawn row's element, by key. */
  rowNodes: Map<string, unknown>
  /** Each laid-out row's height, by key. */
  rowHeights: Map<string, number>
  onScreen: RefObject<RowsOnScreen>
}

export interface ScrollToRow {
  key: string
  index: number
  animated: boolean
  /** Whether the row was among those held before the latest rows: only then can it be on screen. */
  wasHeld: boolean
  onArrived: (() => void) | undefined
}

/** Scrolls a transcript to a row, per platform. */
export interface RowScroller {
  scrollTo: (to: ScrollToRow) => void
  /** Forgets the row being scrolled to, for a scroll elsewhere. */
  cancel: () => void
  onRowHeight: (key: string, heightPx: number) => void
  /** Rows were added or grew while the list was landing on a row. */
  onContentGrew: () => void
  /** The reader took the scroll. */
  onReaderTouch: () => void
  /** A scroll stopped by itself. */
  onScrollStopped: () => void
  /** Whether a page asked for above would be added before the row being landed on is placed. */
  holdsStart: () => boolean
  onScrollToIndexFailed: (info: { index: number; averageItemLength: number }) => void
}
