import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react'
import {
  FlatList,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native'

import { ROW_FRAMES } from './indexTarget'
import { nearStart, type ScrollReading } from './listEdges'
import { MeasuredRow } from './MeasuredRow'
import { useRovingRows, type RovingRowsProps } from './rovingRows'
import { useRowScroller } from './rowScroller'
import type { RowsOnScreen } from './rowScroller.types'
import { useTranscriptPlatform } from './transcriptPlatform'
import { useReducedMotion } from './useReducedMotion'

/** What a screen moves a transcript by. */
export interface TranscriptListHandle {
  /**
   * Brings a row to the middle of the list, or its top to the list's top where the row is taller
   * than the list. `animated` animates a short move only, and not for reduced motion: a row more
   * than about a list's height away is jumped to. `focus` moves the desktop keyboard's focus to
   * the row's stop once it is drawn, and `onArrived` is called once the row can be seen: at once
   * for a row already on screen, which is left where it is when all of it is, and otherwise when
   * the list stops on it.
   */
  scrollToKey: (
    key: string,
    options?: { animated?: boolean; focus?: boolean; onArrived?: () => void },
  ) => void
  /** Whether any of the row is drawn inside the list's viewport, as last reported. */
  isOnScreen: (key: string) => boolean
  /**
   * To the last row, where the list then stays. `animated` is dropped for reduced motion, and from
   * more than two list heights away the list first jumps to one list height from the end.
   */
  scrollToEnd: (options?: { animated?: boolean }) => void
}

export interface TranscriptListProps<T> extends RovingRowsProps {
  data: readonly T[]
  renderItem: (item: T, index: number) => React.ReactElement | null
  keyExtractor: (item: T, index: number) => string
  testID?: string
  handle?: Ref<TranscriptListHandle> | undefined
  /**
   * The first row is in reach (two list heights on native, half of one on the web), or the rows do
   * not fill the list: once per content height, so a page that arrives and still leaves the start
   * in reach asks again.
   */
  onStartReached?: (() => void) | undefined
  /** Whether the end is more than one list's height away, said when that changes. */
  onFarFromEnd?: ((far: boolean) => void) | undefined
  /** Within half a list's height of the last row. */
  onEndReached?: (() => void) | undefined
  /** Back at the last row after leaving it, and not by a landing's own placing. */
  onAtEnd?: (() => void) | undefined
  /** The keys of the rows drawn inside the viewport, each time that set changes. */
  onRowsOnScreen?: ((keys: ReadonlySet<string>) => void) | undefined
  /** Drawn above the first row, scrolled with the rows: what is happening past the start. */
  header?: React.JSX.Element | undefined
}

/** How close to its end a list still counts as at it, and follows content that grows. */
const AT_END_SLACK_PX = 8
/** How long a scroll to the end is given to get there before the list stops holding to it. */
const SEEK_END_MS = 1000
/** How long after a scroll to a row the list's position is its own doing, not the reader's. */
const LANDING_MS = 1500
/**
 * How many list heights from its end a scroll there is animated all the way. Further, the rows on
 * the way have not been measured, and their real heights keep moving the end an animated scroll
 * is heading for: legacy mobile jumped close first too.
 */
const ANIMATED_END_VIEWPORTS = 2
/**
 * How long after the content or the list changed size a scroll is taken for the list's own: one
 * that keeps the place as rows change above, or follows the end. Any other is the reader's, a
 * finger's, a screen reader's or a keyboard's.
 */
const OWN_SCROLL_MS = 300

const VIEWABILITY = { itemVisiblePercentThreshold: 1 } as const

const FILLS = { flex: 1 } as const
const HIDDEN = { flex: 1, opacity: 0 } as const

/**
 * A conversation's messages, a page at a time: opens on its last row and follows its end as rows
 * arrive or grow, until scrolled away from it, and keeps what is on screen in place when rows are
 * added before it. Every row is drawn on the first pass, so the end is known before anything is
 * shown: for a list handed a page at a time, not a thousand rows.
 */
export function TranscriptList<T>({
  data,
  renderItem,
  keyExtractor,
  testID,
  rovingFocus,
  onRowMenu,
  handle,
  onStartReached,
  onFarFromEnd,
  onEndReached,
  onAtEnd,
  onRowsOnScreen,
  header,
}: TranscriptListProps<T>) {
  const rowHeights = useRef(new Map<string, number>())
  const rowNodes = useRef(new Map<string, unknown>())
  const onScreen = useRef<RowsOnScreen>(null)
  const keys = useMemo(() => data.map(keyExtractor), [data, keyExtractor])
  const reducedMotion = useReducedMotion()

  const list = useRef<FlatList<T> | null>(null)
  /** The scroller as last reported: scroll events do not say that content grew. */
  const scroll = useRef<ScrollReading>({
    offsetPx: 0,
    viewportPx: 0,
    contentPx: 0,
    offsetAtContentPx: 0,
  })
  const atEnd = useRef(true)
  const far = useRef(false)
  const startAskedAtPx = useRef(-1)
  // On its way to the end, by `scrollToEnd`: an animated scroll reports every offset it passes,
  // none of them the end, and the rows drawn as it nears change where the end is.
  const seekingEnd = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Just put on a row: the rows drawn around it can leave the scroll at the window's end, which
  // is not the reader coming back to the newest message.
  const landing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  /** When the content or the list last changed size, after which the list may move itself. */
  const resizedAtMs = useRef(0)
  /** The reader has moved the list since it opened, by whatever means. */
  const readerMoved = useRef(false)
  // The first pass alone draws every row. FlatList keeps its first `initialNumToRender` rows
  // mounted for good, so a count that followed the data would mount every page ever read.
  const [firstPassRows] = useState(() => Math.max(data.length, 1))
  // Not shown until it is at its end.
  const [placed, setPlaced] = useState(false)
  const onPlaced = useCallback(() => {
    setPlaced(true)
  }, [])

  /**
   * To the scroll view's own end. The list's `scrollToEnd` reckons the end from its rows'
   * measurements, which rows just handed to it do not have yet.
   */
  const toEnd = useCallback((animated: boolean) => {
    const scrollView = list.current?.getScrollResponder() as
      { scrollToEnd?: (options: { animated: boolean }) => void } | null | undefined
    scrollView?.scrollToEnd?.({ animated })
  }, [])

  const rows = useRowScroller({
    list,
    scroll,
    rowNodes: rowNodes.current,
    rowHeights: rowHeights.current,
    onScreen,
  })
  const onReaderTouch = useCallback(() => {
    clearTimeout(landing.current)
    landing.current = undefined
  }, [])
  const platform = useTranscriptPlatform({
    list,
    keys,
    atEnd,
    firstPassRows,
    toEnd,
    onPlaced,
    onReaderTouch,
    onReaderDrag: rows.onReaderTouch,
    onScrollStopped: rows.onScrollStopped,
  })

  const onRowHeight = useCallback(
    (key: string, heightPx: number) => {
      rowHeights.current.set(key, heightPx)
      rows.onRowHeight(key, heightPx)
    },
    [rows],
  )
  const onRowGone = useCallback((key: string) => {
    rowHeights.current.delete(key)
  }, [])
  const renderMeasured = useCallback(
    (item: T, index: number) => (
      <MeasuredRow
        rowKey={keyExtractor(item, index)}
        nodes={rowNodes.current}
        onHeight={onRowHeight}
        onGone={onRowGone}
      >
        {renderItem(item, index)}
      </MeasuredRow>
    ),
    [keyExtractor, renderItem, onRowHeight, onRowGone],
  )
  const { focus, renderRow, withFocus } = useRovingRows({
    rovingFocus,
    onRowMenu,
    inverted: false,
    data,
    renderItem: renderMeasured,
    keyExtractor,
  })
  const attach = useCallback(
    (node: FlatList<T> | null) => {
      list.current = node
      focus?.attach(node)
    },
    [focus],
  )

  const latest = useRef({
    keys,
    onStartReached,
    onFarFromEnd,
    onAtEnd,
    onRowsOnScreen,
    platform,
    rows,
  })
  // The rows before the ones now held: what is on screen is known of those until these are drawn.
  const keysBefore = useRef(keys)
  useLayoutEffect(() => {
    if (latest.current.keys !== keys) keysBefore.current = latest.current.keys
    latest.current = { keys, onStartReached, onFarFromEnd, onAtEnd, onRowsOnScreen, platform, rows }
  })

  /** Reports what the scroller's position means, from wherever it was learnt. */
  const report = useCallback(() => {
    const { viewportPx, contentPx } = scroll.current
    const { platform: here } = latest.current
    // Rows with no height yet are not laid out: nothing is at the start or the end of them.
    if (viewportPx === 0 || (contentPx === 0 && latest.current.keys.length > 0)) return
    // Following the end, the offset is where the scroll about to happen puts it.
    const offsetPx = atEnd.current ? Math.max(0, contentPx - viewportPx) : scroll.current.offsetPx
    const isFar = contentPx - offsetPx - viewportPx > viewportPx
    if (isFar !== far.current) {
      far.current = isFar
      latest.current.onFarFromEnd?.(isFar)
    }
    // Following the end, the offset is reckoned from the height, so it is never out of date.
    const atStart = atEnd.current
      ? offsetPx <= viewportPx * here.startViewports
      : nearStart(scroll.current, here.startViewports)
    if (atStart === null) return
    if (!atStart) {
      // Coming back to the start asks again: a page that failed left the height as it was.
      startAskedAtPx.current = -1
    } else if (startAskedAtPx.current !== contentPx) {
      // Native shows rows added above a list at its end as a jump there and back. A list that
      // opened full waits for the reader to move it before it asks for more.
      if (atEnd.current && !readerMoved.current && here.untouched() && contentPx > viewportPx)
        return
      if (latest.current.rows.holdsStart()) return
      // Just put on a row: rows added above it now are not held in place on Android, and the
      // landing slides away. The reader's next scroll asks.
      if (landing.current !== undefined) return
      startAskedAtPx.current = contentPx
      latest.current.onStartReached?.()
    }
  }, [])

  const followEnd = useCallback(() => {
    if (atEnd.current) toEnd(false)
  }, [toEnd])

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent
      // Rows that changed under a list at its end move the scroll before their new height is
      // reported: that is not the reader leaving the end, and the report then follows it.
      const resized =
        contentSize.height !== scroll.current.contentPx ||
        layoutMeasurement.height !== scroll.current.viewportPx
      if (resized) resizedAtMs.current = Date.now()
      // An animated scroll to the end only ever moves down.
      const movedUp = !resized && contentOffset.y < scroll.current.offsetPx - AT_END_SLACK_PX
      scroll.current = {
        offsetPx: contentOffset.y,
        viewportPx: layoutMeasurement.height,
        contentPx: contentSize.height,
        offsetAtContentPx: contentSize.height,
      }
      const reachesEnd =
        contentSize.height - contentOffset.y - layoutMeasurement.height <= AT_END_SLACK_PX
      const byReader =
        latest.current.platform.readerScrolled() || Date.now() - resizedAtMs.current > OWN_SCROLL_MS
      // Heading for the end, a scroll back up is the reader taking over.
      if (reachesEnd || (movedUp && byReader)) {
        clearTimeout(seekingEnd.current)
        seekingEnd.current = undefined
      }
      if (resized && atEnd.current) followEnd()
      else if (seekingEnd.current !== undefined) {
        // Held to the end until it gets there.
      } else if (landing.current !== undefined) {
        // Not the reader's scroll: where it is counts once the landing is over.
      } else if (byReader || reachesEnd) {
        const arrived = reachesEnd && !atEnd.current
        atEnd.current = reachesEnd
        if (byReader && !reachesEnd) readerMoved.current = true
        if (arrived) latest.current.onAtEnd?.()
      }
      // The list moved itself to keep its place as rows changed above: at the end, that is not
      // the reader leaving it.
      else followEnd()
      report()
    },
    [followEnd, report],
  )

  const onContentSizeChange = useCallback(
    (_width: number, height: number) => {
      if (height !== scroll.current.contentPx) resizedAtMs.current = Date.now()
      scroll.current.contentPx = height
      if (landing.current !== undefined) latest.current.rows.onContentGrew()
      followEnd()
      setPlaced(true)
      report()
    },
    [followEnd, report],
  )

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      if (event.nativeEvent.layout.height !== scroll.current.viewportPx)
        resizedAtMs.current = Date.now()
      scroll.current.viewportPx = event.nativeEvent.layout.height
      followEnd()
      setPlaced(true)
      report()
    },
    [followEnd, report],
  )

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: { index?: number | null | undefined }[] }) => {
      const indices = viewableItems.flatMap(({ index }) =>
        typeof index === 'number' ? [index] : [],
      )
      onScreen.current =
        indices.length === 0 ? null : { first: Math.min(...indices), last: Math.max(...indices) }
      const tell = latest.current.onRowsOnScreen
      if (tell === undefined) return
      const all = latest.current.keys
      tell(new Set(indices.flatMap((index) => all[index] ?? [])))
    },
    [],
  )

  useImperativeHandle(
    handle,
    (): TranscriptListHandle => ({
      scrollToKey(key, { animated = false, focus: focusRow = false, onArrived } = {}) {
        const index = latest.current.keys.indexOf(key)
        if (index === -1) return
        atEnd.current = false
        clearTimeout(seekingEnd.current)
        seekingEnd.current = undefined
        clearTimeout(landing.current)
        landing.current = setTimeout(() => {
          landing.current = undefined
          const { offsetPx, viewportPx, contentPx } = scroll.current
          atEnd.current = contentPx - offsetPx - viewportPx <= AT_END_SLACK_PX
        }, LANDING_MS)
        rows.scrollTo({
          key,
          index,
          animated: animated && !reducedMotion,
          wasHeld: keysBefore.current.includes(key),
          onArrived,
        })
        if (!focusRow || focus === null) return
        let frames = 0
        const tryFocus = () => {
          frames += 1
          if (!focus.focusRow(key) && frames < ROW_FRAMES) requestAnimationFrame(tryFocus)
        }
        requestAnimationFrame(tryFocus)
      },
      isOnScreen(key) {
        const index = latest.current.keys.indexOf(key)
        const shown = onScreen.current
        return index !== -1 && shown !== null && index >= shown.first && index <= shown.last
      },
      scrollToEnd({ animated = false } = {}) {
        atEnd.current = true
        rows.cancel()
        clearTimeout(landing.current)
        landing.current = undefined
        clearTimeout(seekingEnd.current)
        seekingEnd.current = setTimeout(() => {
          seekingEnd.current = undefined
        }, SEEK_END_MS)
        const smooth = animated && !reducedMotion
        const { offsetPx, viewportPx, contentPx } = scroll.current
        if (smooth && contentPx - offsetPx - viewportPx > viewportPx * ANIMATED_END_VIEWPORTS)
          list.current?.scrollToOffset({ offset: contentPx - 2 * viewportPx, animated: false })
        toEnd(smooth)
      },
    }),
    [focus, reducedMotion, rows, toEnd],
  )

  useEffect(
    () => () => {
      clearTimeout(seekingEnd.current)
      clearTimeout(landing.current)
    },
    [],
  )

  return withFocus(
    <FlatList
      style={placed ? FILLS : HIDDEN}
      ref={attach}
      onScroll={onScroll}
      scrollEventThrottle={16}
      onContentSizeChange={onContentSizeChange}
      onLayout={onLayout}
      {...platform.listProps}
      onScrollToIndexFailed={rows.onScrollToIndexFailed}
      onViewableItemsChanged={onViewableItemsChanged}
      viewabilityConfig={VIEWABILITY}
      ListHeaderComponent={header}
      data={data}
      renderItem={renderRow}
      keyExtractor={keyExtractor}
      // With the keyboard up, a tap on the list's own background puts it away and a drag does
      // too, while a tap on a control inside still reaches the control.
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      {...(testID === undefined ? {} : { testID })}
      {...(onEndReached === undefined ? {} : { onEndReached, onEndReachedThreshold: 0.5 })}
    />,
  )
}
