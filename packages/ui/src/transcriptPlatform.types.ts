import type { RefObject } from 'react'
import type { ScrollViewProps } from 'react-native'

import type { RowsOnScreen } from './rowScroller.types'

/** What the platform's half of a transcript list is given. */
export interface TranscriptPlatformInput {
  /** The FlatList, or null before it is drawn. */
  list: RefObject<unknown>
  keys: readonly string[]
  /** Whether the list is following its end. */
  atEnd: RefObject<boolean>
  /** The rows inside the viewport, as last reported. */
  onScreen: RefObject<RowsOnScreen>
  /** Rows the first pass drew: what opened the transcript. */
  firstPassRows: number
  /** Opens at its end, rather than on a row the list scrolls to itself. */
  opensAtEnd: boolean
  toEnd: (animated: boolean) => void
  /** The list is at its end and can be shown. */
  onPlaced: () => void
  /**
   * The reader moved the list: by a finger or the fling it left on native, by a wheel, a touch,
   * the scrollbar or a key on the web.
   */
  onReaderTouch: () => void
  /**
   * The reader took the scroll: a finger on native, not a fling's start, which a jump's own scroll
   * can report too while its row is still to be placed; on the web, as `onReaderTouch`.
   */
  onReaderDrag: () => void
  /** Native: a fling or an animated scroll came to rest. */
  onScrollStopped: () => void
  /** iOS: the scroll to the top a tap on the status bar starts came to rest. */
  onScrolledToTop: () => void
}

/** How a transcript list keeps its place and tells the reader's scroll from its own. */
export interface TranscriptPlatform {
  /** Spread on the FlatList. */
  listProps: { initialNumToRender: number } & Pick<
    ScrollViewProps,
    | 'maintainVisibleContentPosition'
    | 'showsVerticalScrollIndicator'
    | 'onScrollBeginDrag'
    | 'onMomentumScrollBegin'
    | 'onScrollEndDrag'
    | 'onMomentumScrollEnd'
    | 'onScrollToTop'
  >
  /**
   * Whether a tap on the status bar scrolls the list to its top by itself, untouched, and says when
   * it is done: iOS.
   */
  scrollsToTop: boolean
  /**
   * Whether the scroll just reported is surely the reader's, even right after a resize: every
   * scroll on the web, a finger or the fling it left on native.
   */
  readerScrolled: () => boolean
  /** Whether no finger has touched the list since it opened: always false on the web. */
  untouched: () => boolean
  /** Just before the page above is asked for: what the platform needs to keep the reader's row. */
  beforeStartAsked: () => void
}
