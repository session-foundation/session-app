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

import { nearStart, type ScrollReading } from './listEdges'
import { usePaneSurface } from './paneSurface'
import { useRovingRows, type RovingRowsProps } from './rovingRows'
import { useTranscriptPlatform } from './transcriptPlatform'
import { useReducedMotion } from './useReducedMotion'

/** What a screen moves a transcript by. */
export interface TranscriptListHandle {
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
   * not fill the list: once per first row, so a page that arrives and still leaves the start in
   * reach asks again, and again once the reader leaves the start and comes back.
   */
  onStartReached?: (() => void) | undefined
  /** Whether the end is more than one list's height away, said when that changes. */
  onFarFromEnd?: ((far: boolean) => void) | undefined
  /**
   * What is happening past the start, pinned over the list's top edge on the pane's surface while
   * the start is in reach: a list that keeps its first row in place, as native does, would scroll a
   * row added above it at the top just out of view. A spacer of its height leads the list
   * meanwhile, so the first row can still be scrolled clear of it.
   */
  header?: React.JSX.Element | undefined
}

/** How close to its end a list still counts as at it, and follows content that grows. */
const AT_END_SLACK_PX = 8
/** How long a scroll to the end is given to get there before the list stops holding to it. */
const SEEK_END_MS = 1000
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
  header,
}: TranscriptListProps<T>) {
  const { focus, renderRow, withFocus } = useRovingRows({
    rovingFocus,
    onRowMenu,
    inverted: false,
    data,
    renderItem,
    keyExtractor,
  })
  const keys = useMemo(() => data.map(keyExtractor), [data, keyExtractor])
  const reducedMotion = useReducedMotion()

  const list = useRef<FlatList<T> | null>(null)
  const attach = useCallback(
    (node: FlatList<T> | null) => {
      list.current = node
      focus?.attach(node)
    },
    [focus],
  )
  /** The scroller as last reported: scroll events do not say that content grew. */
  const scroll = useRef<ScrollReading>({
    offsetPx: 0,
    viewportPx: 0,
    contentPx: 0,
    offsetAtContentPx: 0,
  })
  const atEnd = useRef(true)
  const far = useRef(false)
  // Whether a pinned header is drawn, as state that changes only when the start comes in reach.
  const startInReach = useRef(false)
  const [showsStart, setShowsStart] = useState(false)
  const [headerPx, setHeaderPx] = useState(0)
  const onHeaderLayout = useCallback((event: LayoutChangeEvent) => {
    setHeaderPx(event.nativeEvent.layout.height)
  }, [])
  const surface = usePaneSurface()
  /** The first row when the page before was last asked for: undefined to ask afresh. */
  const startAskedAt = useRef<string | undefined>(undefined)
  // On its way to the end, by `scrollToEnd`: an animated scroll reports every offset it passes,
  // none of them the end, and the rows drawn as it nears change where the end is.
  const seekingEnd = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
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

  const platform = useTranscriptPlatform({ list, keys, atEnd, firstPassRows, toEnd, onPlaced })

  const latest = useRef({ keys, onStartReached, onFarFromEnd, platform })
  useLayoutEffect(() => {
    latest.current = { keys, onStartReached, onFarFromEnd, platform }
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
    if (atStart !== startInReach.current) {
      startInReach.current = atStart
      setShowsStart(atStart)
    }
    // Asked once per first row: a page that lands brings a new one. A height alone is no reason,
    // as the row past the start that says a page failed changes it too, which asked in a loop.
    const first = latest.current.keys[0]
    if (!atStart) {
      // Coming back to the start asks again, which is how a reader retries without Retry.
      startAskedAt.current = undefined
    } else if (first !== undefined && startAskedAt.current !== first) {
      // Native shows rows added above a list at its end as a jump there and back. A list that
      // opened full waits for the reader to move it before it asks for more.
      if (atEnd.current && !readerMoved.current && here.untouched() && contentPx > viewportPx)
        return
      startAskedAt.current = first
      here.beforeStartAsked()
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
      } else if (byReader || reachesEnd) {
        atEnd.current = reachesEnd
        if (byReader && !reachesEnd) readerMoved.current = true
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

  useImperativeHandle(
    handle,
    (): TranscriptListHandle => ({
      scrollToEnd({ animated = false } = {}) {
        atEnd.current = true
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
    [reducedMotion, toEnd],
  )

  useEffect(
    () => () => {
      clearTimeout(seekingEnd.current)
    },
    [],
  )

  const padStartPx = showsStart && header !== undefined ? headerPx : 0
  // Room for the pinned row as a row of the list's own, not as padding: a padding change that
  // lands in the same pass as a page's rows being measured is not kept in place on Android.
  const startSpacer = useMemo(() => <View style={{ height: padStartPx }} />, [padStartPx])
  const listElement = (
    <FlatList
      style={placed ? FILLS : HIDDEN}
      ref={attach}
      onScroll={onScroll}
      scrollEventThrottle={16}
      onContentSizeChange={onContentSizeChange}
      onLayout={onLayout}
      {...platform.listProps}
      ListHeaderComponent={startSpacer}
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
    header !== undefined ? (
      <YStack flex={1} position="relative">
        {listElement}
        {showsStart ? (
          <YStack
            position="absolute"
            top={0}
            left={0}
            right={0}
            backgroundColor={surface}
            onLayout={onHeaderLayout}
          >
            {header}
          </YStack>
        ) : null}
      </YStack>
    ) : (
      listElement
    ),
  )
}
