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
  View,
} from 'react-native'

import { YStack } from 'tamagui'

import { ROW_FRAMES } from './indexTarget'
import { MeasuredRow } from './MeasuredRow'
import { readEdges as readEdgesOf, type EdgesAsked } from './pageEdges'
import { usePaneSurface } from './paneSurface'
import { useRovingRows, type RovingRowsProps } from './rovingRows'
import { useRowScroller } from './rowScroller'
import { seenRows } from './seenRows'
import type { RowsOnScreen, ScrollReading } from './rowScroller.types'
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
  /** How many list heights below the viewport the last row ends, as last reported. */
  viewportsFromEnd: () => number
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
   * The page before the first row is wanted: fewer than `ROWS_AHEAD` rows are held above those on
   * screen and `moreBefore` says history goes on. Once per first row, and again once the rows on
   * screen leave that reach and come back, so a page that failed waits for its Retry.
   */
  onStartReached?: (() => void) | undefined
  /** Whether history goes on before the first row: without it, nothing is asked for there. */
  moreBefore?: boolean | undefined
  /**
   * Whether the newest message is more than one list's height away, said when that changes. With
   * `moreAfter`, it always is.
   */
  onFarFromEnd?: ((far: boolean) => void) | undefined
  /** As `onStartReached`, for the page after the last row, and never while seeking the end. */
  onEndReached?: (() => void) | undefined
  /** Whether history goes on after the last row. */
  moreAfter?: boolean | undefined
  /**
   * Shown only once at its end rather than on its first layout, for a list drawn afresh where
   * nothing covers it: on native the scroll to the end lands a frame or more later, and its start
   * would show meanwhile. A screen that opens slides over that frame, and opens sooner without it.
   */
  showsOnceAtEnd?: boolean | undefined
  /**
   * Back at the last row after leaving it, or resting there as `moreAfter` turns false; never by a
   * landing's own placing.
   */
  onAtEnd?: (() => void) | undefined
  /** The keys of the rows drawn inside the viewport, each time that set changes. */
  onRowsOnScreen?: ((keys: ReadonlySet<string>) => void) | undefined
  /**
   * The keys of the rows whose bottom edge is on screen, in order, each time that changes: the rows
   * that have been seen. See `seenRows` for what counts.
   */
  onRowsSeen?: ((keys: readonly string[]) => void) | undefined
  /**
   * Whether the page before the first row is held back until a scroll to the top by a tap on the
   * status bar ends, said when that changes: a wait of most of a second, with history before it.
   */
  onWaitsForStart?: ((waits: boolean) => void) | undefined
  /**
   * What is happening past the start, pinned over the list's top edge on the pane's surface while
   * the rows on screen are within `ROWS_AHEAD` of the first: a list that keeps its first row in
   * place, as native does, would scroll a
   * row added above it at the top just out of view. A spacer of its height leads the list
   * meanwhile, so the first row can still be scrolled clear of it.
   */
  header?: React.JSX.Element | undefined
  /** What is happening past the end: drawn and pinned as `header` is, at the bottom. */
  footer?: React.JSX.Element | undefined
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
/** How long a list waits, hidden, for the scroll to its end to report before it shows anyway. */
const PLACE_AT_END_MS = 300
/** The longest a page landing above is given to have the reader's rows put back on screen. */
const SETTLE_ABOVE_MS = 600
/**
 * How long after it last moved a scroll to the top that never says it ended is waited for. UIKit's
 * runs on at the top, with no scroll reported, for most of a second, and ends by putting the list
 * back there: a page held in place meanwhile is scrolled past.
 */
const TO_TOP_MS = 1500

const VIEWABILITY = { itemVisiblePercentThreshold: 1 } as const
/** Wholly on screen, which is when the last row's bottom edge is showing. */
const WHOLLY = { itemVisiblePercentThreshold: 100 } as const

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
  moreBefore = false,
  onFarFromEnd,
  onEndReached,
  moreAfter = false,
  showsOnceAtEnd = false,
  onAtEnd,
  onRowsOnScreen,
  onRowsSeen,
  onWaitsForStart,
  header,
  footer,
}: TranscriptListProps<T>) {
  const rowHeights = useRef(new Map<string, number>())
  const rowNodes = useRef(new Map<string, unknown>())
  const onScreen = useRef<RowsOnScreen>(null)
  // The same rows by key: a report of the rows on screen can come against the rows held before a
  // page landed, whose indices the page has shifted.
  const onScreenKeys = useRef<{ first: string; last: string; all: ReadonlySet<string> } | null>(
    null,
  )
  const keys = useMemo(() => data.map(keyExtractor), [data, keyExtractor])
  const reducedMotion = useReducedMotion()

  const list = useRef<FlatList<T> | null>(null)
  /** The scroller as last reported: scroll events do not say that content grew. */
  const scroll = useRef<ScrollReading>({ offsetPx: 0, viewportPx: 0, contentPx: 0 })
  const atEnd = useRef(true)
  const far = useRef(false)
  // Whether the pinned rows are drawn: state that changes only as the rows on screen come within
  // `ROWS_AHEAD` of either end or leave it. The list opens at its end.
  const [showsStart, setShowsStart] = useState(false)
  const [showsEnd, setShowsEnd] = useState(true)
  // Set on the next frame, and only on a change: the rows on screen are reported in the middle of
  // the list's own update, and re-rendering it there blanked it on Android as a page landed.
  const shows = useRef({ start: false, end: true })
  const showing = useRef<number | undefined>(undefined)
  const [headerPx, setHeaderPx] = useState(0)
  const onHeaderLayout = useCallback((event: LayoutChangeEvent) => {
    setHeaderPx(event.nativeEvent.layout.height)
  }, [])
  const [footerPx, setFooterPx] = useState(0)
  const onFooterLayout = useCallback((event: LayoutChangeEvent) => {
    setFooterPx(event.nativeEvent.layout.height)
  }, [])
  const surface = usePaneSurface()
  const edgesAsked = useRef<EdgesAsked>({ before: undefined, after: undefined })
  // The first row on screen when a page landed above, until it is reported on screen again. Native
  // puts the reader's rows back a frame or more after the page lands, and the rows reported
  // meanwhile are the page's own, at the start: read as they are, they ask for the next page at
  // once, and two pages landing mid-shift blanked the list and lost the reader's place.
  const settlingAbove = useRef<{
    first: string
    untilMs: number
    /** The report the landing came after: nothing it says is news. */
    report: { first: string; last: string }
  } | null>(null)
  // Reads the edges again once `settlingAbove` lapses: a scroll that ends at the top of the page
  // that landed leaves the rows on screen unchanged, so no report comes to read them.
  const settled = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // On its way to the end, by `scrollToEnd`: an animated scroll reports every offset it passes,
  // none of them the end, and the rows drawn as it nears change where the end is.
  const seekingEnd = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Just put on a row: the rows drawn around it can leave the scroll at the window's end, which
  // is not the reader coming back to the newest message.
  const landing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // On its way to the top by a tap on the status bar: a page landing above before it stops is not
  // held in place, and the screen jumps to the page's first rows.
  const toTop = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const waitsForStart = useRef(false)
  // The header is drawn over the list's top, with no room made for it, from a scroll to the top
  // until the page it asks for lands: at offset 0, iOS keeps no place behind that room.
  const [overlaysStart, setOverlaysStart] = useState(false)
  const tellWaitsForStart = useCallback((waits: boolean) => {
    const told = waits && latest.current.moreBefore
    if (told) setOverlaysStart(true)
    if (told === waitsForStart.current) return
    waitsForStart.current = told
    latest.current.onWaitsForStart?.(told)
  }, [])
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
  // Shown once it is at its end, not on its first layout: the scroll to the end lands a frame
  // later, and a list nothing covers, drawn afresh in place, would show its start for that frame.
  const placing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const place = useCallback(() => {
    clearTimeout(placing.current)
    setPlaced(true)
  }, [])
  const waitsForEnd = useRef(showsOnceAtEnd)
  const placeAtEnd = useCallback(() => {
    if (!waitsForEnd.current) {
      place()
      return
    }
    const { viewportPx, contentPx } = scroll.current
    if (viewportPx === 0 || contentPx === 0) return
    if (contentPx - viewportPx <= AT_END_SLACK_PX) place()
    else placing.current ??= setTimeout(place, PLACE_AT_END_MS)
  }, [place])

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
  // Set below, once what it reads is declared.
  const readEdges = useRef<() => void>(() => undefined)
  const onReaderTouch = useCallback(() => {
    clearTimeout(landing.current)
    landing.current = undefined
    clearTimeout(toTop.current)
    toTop.current = undefined
    setOverlaysStart(false)
    // A landing, a scroll to the top or an untouched list held its asks back.
    readEdges.current()
    // After the ask: the page it reads is then said to be loading, with no gap since the wait.
    tellWaitsForStart(false)
  }, [tellWaitsForStart])
  const onScrolledToTop = useCallback(() => {
    clearTimeout(toTop.current)
    toTop.current = undefined
    readEdges.current()
    tellWaitsForStart(false)
  }, [tellWaitsForStart])
  const platform = useTranscriptPlatform({
    list,
    keys,
    atEnd,
    onScreen,
    firstPassRows,
    toEnd,
    onPlaced,
    onReaderTouch,
    onReaderDrag: rows.onReaderTouch,
    onScrollStopped: rows.onScrollStopped,
    onScrolledToTop,
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
    moreBefore,
    moreAfter,
    onStartReached,
    onEndReached,
    onFarFromEnd,
    onAtEnd,
    onRowsOnScreen,
    onRowsSeen,
    onWaitsForStart,
    platform,
    rows,
  })
  // The rows before the ones now held: what is on screen is known of those until these are drawn.
  const keysBefore = useRef(keys)
  useLayoutEffect(() => {
    if (latest.current.keys !== keys) {
      keysBefore.current = latest.current.keys
      const wasFirst = latest.current.keys[0]
      const shown = onScreenKeys.current
      // Rows added above the ones held, rather than a window replaced by another.
      if (wasFirst !== undefined && keys.indexOf(wasFirst) > 0 && shown !== null)
        settlingAbove.current = {
          first: shown.first,
          untilMs: Date.now() + SETTLE_ABOVE_MS,
          report: shown,
        }
      // Rows added after the last one held, in a window short of the newest: its end has moved
      // away from a reader resting there, who is not to be followed to the newest message when the
      // page that reaches it lands.
      const wasLast = latest.current.keys[latest.current.keys.length - 1]
      const lastAt = wasLast === undefined ? -1 : keys.indexOf(wasLast)
      if (latest.current.moreAfter && lastAt !== -1 && lastAt < keys.length - 1)
        atEnd.current = false
    }
    latest.current = {
      keys,
      moreBefore,
      moreAfter,
      onStartReached,
      onEndReached,
      onFarFromEnd,
      onAtEnd,
      onRowsOnScreen,
      onRowsSeen,
      onWaitsForStart,
      platform,
      rows,
    }
  })

  /** Reports whether the end is far, from wherever the scroller's position was learnt. */
  const report = useCallback(() => {
    const { viewportPx, contentPx } = scroll.current
    // Rows with no height yet are not laid out: nothing is far from the end of them.
    if (viewportPx === 0 || (contentPx === 0 && latest.current.keys.length > 0)) return
    // Following the end, the offset is where the scroll about to happen puts it.
    const offsetPx = atEnd.current ? Math.max(0, contentPx - viewportPx) : scroll.current.offsetPx
    // A window short of the newest message is far from it wherever its own end is: the page that
    // reaches the newest lands below a reader resting there.
    const isFar = latest.current.moreAfter || contentPx - offsetPx - viewportPx > viewportPx
    if (isFar !== far.current) {
      far.current = isFar
      latest.current.onFarFromEnd?.(isFar)
    }
  }, [])

  /**
   * Asks for the page past either end the rows on screen are within `ROWS_AHEAD` of, once per end
   * row: see `readEdges` in pageEdges.ts. Run whenever the rows on screen change, and when a
   * landing or an untouched list stops holding the asks back.
   */
  readEdges.current = () => {
    const shown = onScreenKeys.current
    if (shown === null) return
    const settling = settlingAbove.current
    if (settling !== null) {
      // Only a report made since the landing says where the rows are now.
      if (shown === settling.report) return
      const { keys: rowsHeld } = latest.current
      const at = rowsHeld.indexOf(settling.first)
      const back = at >= rowsHeld.indexOf(shown.first) && at <= rowsHeld.indexOf(shown.last)
      const leftMs = settling.untilMs - Date.now()
      if (!back && leftMs > 0) {
        clearTimeout(settled.current)
        settled.current = setTimeout(() => {
          settled.current = undefined
          readEdges.current()
        }, leftMs)
        return
      }
      clearTimeout(settled.current)
      settlingAbove.current = null
    }
    const { keys: held, moreBefore: before, moreAfter: after, platform: here } = latest.current
    const { contentPx, viewportPx } = scroll.current
    // Just put on a row: rows added above it now are not held in place on Android, and the landing
    // slides away; rows added below would be a page the reader has not reached. Asked once it ends.
    const landingNow = landing.current !== undefined
    const seekingNow = seekingEnd.current !== undefined
    // Native shows rows added above a list at its end as a jump there and back: a list that opened
    // full waits for the reader to move it before it asks for more.
    const untouched =
      atEnd.current && !readerMoved.current && here.untouched() && contentPx > viewportPx
    const read = readEdgesOf({
      shown,
      held,
      moreBefore: before,
      moreAfter: after,
      // Seeking the end is the list moving itself: a page landing above would shift it short.
      holdBefore:
        landingNow ||
        seekingNow ||
        untouched ||
        toTop.current !== undefined ||
        latest.current.rows.holdsStart(),
      holdAfter: landingNow || seekingNow,
      asked: edgesAsked.current,
    })
    if (read === null) return
    edgesAsked.current = read.asked
    if (read.near.before !== shows.current.start || read.near.after !== shows.current.end) {
      shows.current = { start: read.near.before, end: read.near.after }
      if (showing.current !== undefined) cancelAnimationFrame(showing.current)
      showing.current = requestAnimationFrame(() => {
        showing.current = undefined
        setShowsStart(shows.current.start)
        setShowsEnd(shows.current.end)
      })
    }
    if (read.ask.before) {
      here.beforeStartAsked()
      latest.current.onStartReached?.()
    }
    if (read.ask.after) latest.current.onEndReached?.()
  }

  // Only the newest message is followed: a window short of it ends where the next page goes, and
  // following that end as each page lands put the reader there again to ask for the next.
  const followsEnd = useCallback(() => atEnd.current && !latest.current.moreAfter, [])
  const followEnd = useCallback(() => {
    if (followsEnd()) toEnd(false)
  }, [followsEnd, toEnd])

  // The rows on screen and the rows wholly on screen, by index, each with its key: what is seen is
  // worked out from both and from whether the list sits at its end (`seenRows`).
  const visibleRows = useRef(new Map<number, string>())
  const wholeRows = useRef<ReadonlySet<number>>(new Set())
  const seenReported = useRef('')
  const reportSeen = useCallback(() => {
    const tell = latest.current.onRowsSeen
    if (tell === undefined) return
    const { offsetPx, viewportPx, contentPx } = scroll.current
    const atEndNow = contentPx - offsetPx - viewportPx <= AT_END_SLACK_PX
    const seen = seenRows({
      visible: [...visibleRows.current.keys()],
      whole: wholeRows.current,
      atEnd: atEndNow,
    }).flatMap((index) => {
      const key = visibleRows.current.get(index)
      return key === undefined ? [] : [key]
    })
    const reported = seen.join('\n')
    if (reported === seenReported.current) return
    seenReported.current = reported
    tell(seen)
  }, [])

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
      const { platform: here } = latest.current
      // Untouched and none of the list's own moves: the status bar's scroll to the top.
      if (
        here.scrollsToTop &&
        Date.now() - resizedAtMs.current > OWN_SCROLL_MS &&
        contentOffset.y < scroll.current.offsetPx &&
        !here.readerScrolled() &&
        landing.current === undefined &&
        seekingEnd.current === undefined
      ) {
        clearTimeout(toTop.current)
        toTop.current = setTimeout(onScrolledToTop, TO_TOP_MS)
        tellWaitsForStart(true)
      }
      scroll.current = {
        offsetPx: contentOffset.y,
        viewportPx: layoutMeasurement.height,
        contentPx: contentSize.height,
      }
      const reachesEnd =
        contentSize.height - contentOffset.y - layoutMeasurement.height <= AT_END_SLACK_PX
      if (reachesEnd) place()
      const byReader =
        latest.current.platform.readerScrolled() || Date.now() - resizedAtMs.current > OWN_SCROLL_MS
      // Heading for the end, a scroll back up is the reader taking over.
      if (reachesEnd || (movedUp && byReader)) {
        clearTimeout(seekingEnd.current)
        seekingEnd.current = undefined
      }
      if (resized && followsEnd()) followEnd()
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
      reportSeen()
    },
    [followEnd, followsEnd, onScrolledToTop, place, report, reportSeen, tellWaitsForStart],
  )

  const onContentSizeChange = useCallback(
    (_width: number, height: number) => {
      if (height !== scroll.current.contentPx) resizedAtMs.current = Date.now()
      scroll.current.contentPx = height
      if (landing.current !== undefined) latest.current.rows.onContentGrew()
      followEnd()
      placeAtEnd()
      report()
      reportSeen()
    },
    [followEnd, placeAtEnd, report, reportSeen],
  )

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      if (event.nativeEvent.layout.height !== scroll.current.viewportPx)
        resizedAtMs.current = Date.now()
      scroll.current.viewportPx = event.nativeEvent.layout.height
      followEnd()
      placeAtEnd()
      report()
      reportSeen()
    },
    [followEnd, placeAtEnd, report, reportSeen],
  )

  const onViewableItemsChanged = useCallback(
    ({
      viewableItems,
    }: {
      viewableItems: { index?: number | null | undefined; key?: string | undefined }[]
    }) => {
      visibleRows.current = new Map(
        viewableItems.flatMap(({ index, key }) =>
          typeof index === 'number' && key !== undefined ? [[index, key] as const] : [],
        ),
      )
      reportSeen()
      const indices = viewableItems.flatMap(({ index }) =>
        typeof index === 'number' ? [index] : [],
      )
      const first = Math.min(...indices)
      const last = Math.max(...indices)
      onScreen.current = indices.length === 0 ? null : { first, last }
      const keyAt = (at: number) => viewableItems.find(({ index }) => index === at)?.key
      const firstKey = keyAt(first)
      const lastKey = keyAt(last)
      const all = new Set(viewableItems.flatMap(({ key }) => (key === undefined ? [] : [key])))
      onScreenKeys.current =
        firstKey === undefined || lastKey === undefined
          ? null
          : { first: firstKey, last: lastKey, all }
      readEdges.current()
      latest.current.onRowsOnScreen?.(all)
    },
    [reportSeen],
  )
  // Made once: FlatList refuses a change to its viewability pairs after its first render.
  const viewabilityPairs = useRef([
    { viewabilityConfig: VIEWABILITY, onViewableItemsChanged },
    {
      viewabilityConfig: WHOLLY,
      onViewableItemsChanged: ({
        viewableItems,
      }: {
        viewableItems: { index?: number | null | undefined }[]
      }) => {
        wholeRows.current = new Set(
          viewableItems.flatMap(({ index }) => (typeof index === 'number' ? [index] : [])),
        )
        reportSeen()
      },
    },
  ]).current

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
          readEdges.current()
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
        return onScreenKeys.current?.all.has(key) === true
      },
      viewportsFromEnd() {
        const { offsetPx, viewportPx, contentPx } = scroll.current
        if (viewportPx === 0) return 0
        return Math.max(0, contentPx - offsetPx - viewportPx) / viewportPx
      },
      scrollToEnd({ animated = false } = {}) {
        atEnd.current = true
        rows.cancel()
        clearTimeout(landing.current)
        landing.current = undefined
        clearTimeout(seekingEnd.current)
        seekingEnd.current = setTimeout(() => {
          seekingEnd.current = undefined
          readEdges.current()
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

  // A page landing, or an end becoming known, need not change which rows are on screen.
  useEffect(() => {
    readEdges.current()
  }, [keys, moreBefore, moreAfter])

  // A newer read that finds nothing ends the window at the newest message and changes no size, so
  // nothing else says how far the end is. Rows that did arrive say it once they are measured: told
  // now, before then, the newest message would be near for a moment.
  const lastKeyHeld = useRef(keys[keys.length - 1])
  const moreAfterHeld = useRef(moreAfter)
  useEffect(() => {
    const lastKey = keys[keys.length - 1]
    if (lastKeyHeld.current === lastKey) report()
    lastKeyHeld.current = lastKey
    // A reader resting on the window's last row is at the newest message once nothing follows it.
    const endFound = moreAfterHeld.current && !moreAfter
    moreAfterHeld.current = moreAfter
    if (
      endFound &&
      atEnd.current &&
      landing.current === undefined &&
      seekingEnd.current === undefined
    )
      latest.current.onAtEnd?.()
  }, [keys, moreAfter, report])

  useEffect(
    () => () => {
      clearTimeout(seekingEnd.current)
      clearTimeout(landing.current)
      clearTimeout(settled.current)
      clearTimeout(toTop.current)
      clearTimeout(placing.current)
      if (showing.current !== undefined) cancelAnimationFrame(showing.current)
    },
    [],
  )

  // A page landed above: the header it was read under is gone.
  const [firstKeyHeld, setFirstKeyHeld] = useState(keys[0])
  if (firstKeyHeld !== keys[0]) {
    setFirstKeyHeld(keys[0])
    setOverlaysStart(false)
  }
  const padStartPx = showsStart && header !== undefined && !overlaysStart ? headerPx : 0
  const padEndPx = showsEnd && footer !== undefined ? footerPx : 0
  // Room for the pinned rows as rows of the list's own, not as padding: a padding change that
  // lands in the same pass as a page's rows being measured is not kept in place on Android.
  const startSpacer = useMemo(() => <View style={{ height: padStartPx }} />, [padStartPx])
  const endSpacer = useMemo(() => <View style={{ height: padEndPx }} />, [padEndPx])
  const listElement = (
    <FlatList
      style={placed ? FILLS : HIDDEN}
      ref={attach}
      onScroll={onScroll}
      scrollEventThrottle={16}
      onContentSizeChange={onContentSizeChange}
      onLayout={onLayout}
      {...platform.listProps}
      onScrollToIndexFailed={rows.onScrollToIndexFailed}
      viewabilityConfigCallbackPairs={viewabilityPairs}
      ListHeaderComponent={startSpacer}
      ListFooterComponent={endSpacer}
      data={data}
      renderItem={renderRow}
      keyExtractor={keyExtractor}
      // With the keyboard up, a tap on the list's own background puts it away and a drag does
      // too, while a tap on a control inside still reaches the control.
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      {...(testID === undefined ? {} : { testID })}
    />
  )
  return withFocus(
    header !== undefined || footer !== undefined ? (
      <YStack flex={1} position="relative">
        {/* Before the list, as it is drawn above it: a screen reader and Tab reach it first. */}
        {showsStart && header !== undefined ? (
          <YStack
            position="absolute"
            top={0}
            left={0}
            right={0}
            zIndex={1}
            backgroundColor={surface}
            onLayout={onHeaderLayout}
          >
            {header}
          </YStack>
        ) : null}
        {listElement}
        {showsEnd && footer !== undefined ? (
          <YStack
            position="absolute"
            bottom={0}
            left={0}
            right={0}
            backgroundColor={surface}
            onLayout={onFooterLayout}
          >
            {footer}
          </YStack>
        ) : null}
      </YStack>
    ) : (
      listElement
    ),
  )
}
