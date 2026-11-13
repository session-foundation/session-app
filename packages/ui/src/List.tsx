import {
  useCallback,
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
import { isWeb } from 'tamagui'

import { SPACING } from '@session/theme-tokens'

import {
  ListFocus,
  ListFocusContext,
  ListRowKey,
  type ListFocusEntry,
  type ListRowMenu,
} from './listFocus'

/** What a screen moves a list by. */
export interface ListHandle {
  /** To the last row, where a list that `startsAtEnd` then stays. */
  scrollToEnd: (options?: { animated?: boolean }) => void
}

/** How close to its end a list still counts as at it, and follows content that grows. */
const AT_END_SLACK_PX = 8
/** How much of the list's height from its first row counts as reaching the start. */
const START_REACHED_VIEWPORTS = 0.5

const KEEPS_PLACE = { minIndexForVisible: 0 } as const
const HIDDEN = { flex: 1, opacity: 0 } as const

interface WebScroller {
  scrollTop: number
  scrollHeight: number
}

export interface ListProps<T> {
  data: readonly T[]
  renderItem: (item: T, index: number) => React.ReactElement | null
  keyExtractor: (item: T, index: number) => string
  /** Fixed row height in pixels. Omit only when rows genuinely vary. */
  itemHeight?: number
  /** Rendered in place of the rows when there are none. */
  empty?: React.ReactElement | null
  header?: React.ReactElement | null
  inverted?: boolean
  testID?: string
  onEndReached?: () => void
  /**
   * As tall as its rows, up to what its container allows, rather than filling the container. For
   * a list in a surface that sizes itself to its content, such as a sheet.
   */
  fitsContent?: boolean
  /** Around the rows, inside the scroller. */
  paddingHorizontal?: keyof typeof SPACING
  /** The row to open on. Only with `itemHeight`, which is what places it before it is drawn. */
  initialScrollIndex?: number | undefined
  /**
   * Makes the list one tab stop on the desktop, with Up and Down moving between rows; a no-op on
   * native. The stop is whatever in each row calls `useListStop`; this says which row Tab enters
   * on before any has been focused.
   */
  rovingFocus?: ListFocusEntry | undefined
  /**
   * With `rovingFocus`: opens a row's menu, against the element that is its stop, on Enter or
   * Space on that element, or the Menu key or Shift+F10 anywhere in the row.
   */
  onRowMenu?: ListRowMenu | undefined
  /** Scrolls the list from outside. */
  handle?: Ref<ListHandle> | undefined
  /**
   * Opens on its last row and follows its end as rows arrive or grow, until scrolled away from
   * it; and keeps what is on screen in place when rows are added before it. Every row is drawn
   * on the first pass, so the end is known before anything is shown: for a list handed a page
   * at a time, not a thousand rows.
   */
  startsAtEnd?: boolean | undefined
  /**
   * The first row is within half a list's height, or the rows do not fill the list: once per
   * content height, so a page that arrives and still leaves the start in reach asks again.
   */
  onStartReached?: (() => void) | undefined
  /** Whether the end is more than one list's height away, said when that changes. */
  onFarFromEnd?: ((far: boolean) => void) | undefined
}

const FILLS = { flex: 1 } as const
const FITS_CONTENT = { flexGrow: 0, flexShrink: 1 } as const

/**
 * A long list, drawn a screenful at a time.
 *
 * `ScrollView` mounts every child it is given, which is fine for a settings page and ruinous for a
 * conversation list: measured on this component set, a thousand rows cost 599 ms to mount on a
 * desktop machine and 1573 ms on an iPhone X. Neither number is about the data - the same list
 * decodes in half a millisecond and 32 ms respectively.
 *
 * `FlatList` is React Native's own windowing list and react-native-web implements it too, so one
 * component covers both apps - the desktop renderer aliases `react-native` to `react-native-web`,
 * which is what makes every other shared component work here as well.
 *
 * **Pass `itemHeight` wherever the rows are a fixed height.** It becomes `getItemLayout`, which is
 * what lets the list place a scrollbar and jump to an offset without having measured anything -
 * the arithmetic being row height times index. Without it the list still windows, but it has to
 * measure as it goes, so the scrollbar settles rather than being right immediately and scrolling
 * to an index is approximate. A transcript, where every message wraps differently, is the case
 * that genuinely cannot supply one.
 */
export function List<T>({
  data,
  renderItem,
  keyExtractor,
  itemHeight,
  empty,
  header,
  inverted,
  testID,
  onEndReached,
  fitsContent = false,
  paddingHorizontal,
  initialScrollIndex,
  rovingFocus,
  onRowMenu,
  handle,
  startsAtEnd = false,
  onStartReached,
  onFarFromEnd,
}: ListProps<T>) {
  // TODO(#533): keyboard on iPad and the iPad app on Mac. Full Keyboard Access reaches a row only
  // as a full-width accessibility element with the button trait, which hides the row's own
  // controls (they would become custom actions); a bubble-shaped highlight and Up/Down need
  // native code.
  const [focus] = useState(() =>
    rovingFocus === undefined || !isWeb ? null : new ListFocus(rovingFocus, inverted ?? false),
  )

  const keys = useMemo(() => data.map(keyExtractor), [data, keyExtractor])
  useLayoutEffect(() => {
    focus?.setKeys(keys)
  }, [focus, keys])

  const list = useRef<FlatList<T> | null>(null)
  const attach = useCallback(
    (node: FlatList<T> | null) => {
      list.current = node
      focus?.attach(node)
    },
    [focus],
  )
  /** The scroller as last reported: scroll events do not say that content grew. */
  const scroll = useRef({ offsetPx: 0, viewportPx: 0, contentPx: 0 })
  const atEnd = useRef(startsAtEnd)
  const far = useRef(false)
  const startAskedAtPx = useRef(-1)
  // The first pass alone draws every row. FlatList keeps its first `initialNumToRender` rows
  // mounted for good, so a count that followed the data would mount every page ever read.
  const [firstPassRows] = useState(() => Math.max(data.length, 1))
  // A list that opens at its end is not shown until it is there.
  const [placed, setPlaced] = useState(!startsAtEnd)

  const latest = useRef({ onStartReached, onFarFromEnd })
  useLayoutEffect(() => {
    latest.current = { onStartReached, onFarFromEnd }
  })

  /** Reports what the scroller's position means, from wherever it was learnt. */
  const report = useCallback(() => {
    const { viewportPx, contentPx } = scroll.current
    if (viewportPx === 0) return
    // Following the end, the offset is where the scroll about to happen puts it.
    const offsetPx = atEnd.current ? Math.max(0, contentPx - viewportPx) : scroll.current.offsetPx
    const isFar = contentPx - offsetPx - viewportPx > viewportPx
    if (isFar !== far.current) {
      far.current = isFar
      latest.current.onFarFromEnd?.(isFar)
    }
    if (offsetPx > viewportPx * START_REACHED_VIEWPORTS) {
      // Coming back to the start asks again: a page that failed to arrive left the height as it was.
      startAskedAtPx.current = -1
    } else if (startAskedAtPx.current !== contentPx) {
      startAskedAtPx.current = contentPx
      latest.current.onStartReached?.()
    }
  }, [])

  const webScroller = useCallback(
    (): WebScroller | null =>
      (
        list.current as { getScrollableNode?: () => WebScroller | null } | null
      )?.getScrollableNode?.() ?? null,
    [],
  )

  /**
   * To the scroll view's own end. The list's `scrollToEnd` reckons the end from its rows'
   * measurements, which rows just handed to it do not have yet.
   */
  const toEnd = useCallback((animated: boolean) => {
    const scrollView = list.current?.getScrollResponder() as
      { scrollToEnd?: (options: { animated: boolean }) => void } | null | undefined
    scrollView?.scrollToEnd?.({ animated })
  }, [])

  const followEnd = useCallback(() => {
    if (atEnd.current) toEnd(false)
  }, [toEnd])

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent
      // Rows that changed under a list at its end move the scroll before their new height is
      // reported: that is not the reader leaving the end, and the report then follows it.
      const resized = contentSize.height !== scroll.current.contentPx
      scroll.current = {
        offsetPx: contentOffset.y,
        viewportPx: layoutMeasurement.height,
        contentPx: contentSize.height,
      }
      if (!(resized && atEnd.current))
        atEnd.current =
          startsAtEnd &&
          contentSize.height - contentOffset.y - layoutMeasurement.height <= AT_END_SLACK_PX
      else followEnd()
      report()
    },
    [startsAtEnd, followEnd, report],
  )

  const onContentSizeChange = useCallback(
    (_width: number, height: number) => {
      scroll.current.contentPx = height
      followEnd()
      setPlaced(true)
      report()
    },
    [followEnd, report],
  )

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      scroll.current.viewportPx = event.nativeEvent.layout.height
      followEnd()
      setPlaced(true)
      report()
    },
    [followEnd, report],
  )

  // The web draws the first pass before this runs and paints after it, so the list is never
  // seen at its start. Native has no layout this early: `onContentSizeChange` places it there.
  useLayoutEffect(() => {
    if (!isWeb || !startsAtEnd) return
    toEnd(false)
    setPlaced(true)
  }, [startsAtEnd, toEnd])

  // Native keeps its place through `maintainVisibleContentPosition`. On the web Chromium anchors
  // the scroll to what is on screen, except at offset 0, where rows added above would be scrolled
  // to rather than past.
  const heldFirstKey = useRef<string | undefined>(undefined)
  const heldHeightPx = useRef(0)
  useLayoutEffect(() => {
    if (!isWeb || !startsAtEnd) return
    const node = webScroller()
    if (node === null) return
    const first = heldFirstKey.current
    const grewAbove = first !== undefined && keys.indexOf(first) > 0
    const grownPx = node.scrollHeight - heldHeightPx.current
    if (grewAbove && grownPx > 0 && node.scrollTop < 1 && !atEnd.current) node.scrollTop = grownPx
    heldFirstKey.current = keys[0]
    heldHeightPx.current = node.scrollHeight
  }, [keys, startsAtEnd, webScroller])

  useImperativeHandle(
    handle,
    (): ListHandle => ({
      scrollToEnd({ animated = false } = {}) {
        atEnd.current = startsAtEnd
        toEnd(animated)
      },
    }),
    [startsAtEnd, toEnd],
  )

  useLayoutEffect(() => {
    if (focus !== null) focus.rowMenu = onRowMenu ?? null
  }, [focus, onRowMenu])

  const renderRow = useCallback(
    ({ item, index }: { item: T; index: number }) => {
      const key = keyExtractor(item, index)
      const row = renderItem(item, index)
      return focus === null ? row : <ListRowKey.Provider value={key}>{row}</ListRowKey.Provider>
    },
    [focus, renderItem, keyExtractor],
  )

  const contentContainerStyle = useMemo(
    () =>
      paddingHorizontal === undefined
        ? undefined
        : { paddingHorizontal: SPACING[paddingHorizontal] },
    [paddingHorizontal],
  )

  const getItemLayout = useCallback(
    (_: ArrayLike<T> | null | undefined, index: number) => ({
      length: itemHeight ?? 0,
      offset: (itemHeight ?? 0) * index,
      index,
    }),
    [itemHeight],
  )

  const tracksScroll = startsAtEnd || onStartReached !== undefined || onFarFromEnd !== undefined
  const drawn = (
    <FlatList
      style={fitsContent ? FITS_CONTENT : placed ? FILLS : HIDDEN}
      {...(contentContainerStyle === undefined ? {} : { contentContainerStyle })}
      ref={attach}
      {...(tracksScroll
        ? { onScroll, scrollEventThrottle: 16, onContentSizeChange, onLayout }
        : {})}
      {...(startsAtEnd
        ? {
            initialNumToRender: firstPassRows,
            ...(isWeb ? {} : { maintainVisibleContentPosition: KEEPS_PLACE }),
          }
        : {})}
      data={data}
      renderItem={renderRow}
      keyExtractor={keyExtractor}
      {...(itemHeight === undefined ? {} : { getItemLayout })}
      {...(itemHeight === undefined || initialScrollIndex === undefined
        ? {}
        : { initialScrollIndex })}
      {...(empty == null ? {} : { ListEmptyComponent: empty })}
      {...(header == null ? {} : { ListHeaderComponent: header })}
      {...(inverted === undefined ? {} : { inverted })}
      // A sheet shows a few rows; FlatList's default 21-screen window renders a long set whole.
      {...(fitsContent ? { windowSize: 3, maxToRenderPerBatch: 5 } : {})}
      // With the keyboard up, a tap on the list's own background puts it away and a drag does
      // too, while a tap on a control inside still reaches the control.
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      {...(testID === undefined ? {} : { testID })}
      {...(onEndReached === undefined ? {} : { onEndReached, onEndReachedThreshold: 0.5 })}
    />
  )
  return focus === null ? (
    drawn
  ) : (
    <ListFocusContext.Provider value={focus}>{drawn}</ListFocusContext.Provider>
  )
}
