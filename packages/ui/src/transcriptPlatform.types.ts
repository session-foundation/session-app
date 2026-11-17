import type { RefObject } from 'react'
import type { ScrollViewProps } from 'react-native'

/** What the platform's half of a transcript list is given. */
export interface TranscriptPlatformInput {
  /** The FlatList, or null before it is drawn. */
  list: RefObject<unknown>
  keys: readonly string[]
  /** Whether the list is following its end. */
  atEnd: RefObject<boolean>
  /** Rows the first pass drew: what opened the transcript. */
  firstPassRows: number
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
  >
  /**
   * Whether the scroll just reported is surely the reader's, even right after a resize: every
   * scroll on the web, a finger or the fling it left on native.
   */
  readerScrolled: () => boolean
  /** Whether no finger has touched the list since it opened: always false on the web. */
  untouched: () => boolean
  /** How many list heights from its first row count as reaching the start. */
  startViewports: number
}
