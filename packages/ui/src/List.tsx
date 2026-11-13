import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react'
import {
  FlatList,
  View,
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
  /**
   * Brings a row to the middle of the list, or its top to the list's top where the row is taller
   * than the list. `animated` animates a short move only: a row more than about a list's height
   * away is jumped to. `focus` moves the desktop keyboard's focus to the row's stop once it is
   * drawn, and `onArrived` is called once the list has stopped on the row.
   */
  scrollToKey: (
    key: string,
    options?: { animated?: boolean; focus?: boolean; onArrived?: () => void },
  ) => void
  /** Whether any of the row is drawn inside the list's viewport, as last reported. */
  isOnScreen: (key: string) => boolean
  /** To the last row, where a list that `startsAtEnd` then stays. */
  scrollToEnd: (options?: { animated?: boolean }) => void
}

/** How close to its end a list still counts as at it, and follows content that grows. */
const AT_END_SLACK_PX = 8
/** How long a scroll to the end is given to get there before the list stops holding to it. */
const SEEK_END_MS = 1000
/** How much of the list's height from its first row counts as reaching the start. */
const START_REACHED_VIEWPORTS = 0.5
/** Native: a row within this many rows of what is on screen is near enough to animate to. */
const NEAR_ROWS = 8
/** How long an animated scroll is given to stop where nothing says that it has. */
const ANIMATED_SCROLL_MS = 500
/** How often a row not yet measured is tried again, and how long between tries. */
const SCROLL_RETRIES = 5
const SCROLL_RETRY_MS = 50
/** How many frames a row is waited for, to be drawn or to take focus, before giving up. */
const ROW_FRAMES = 30

const KEEPS_PLACE = { minIndexForVisible: 0 } as const
const VIEWABILITY = { itemVisiblePercentThreshold: 1 } as const
const HIDDEN = { flex: 1, opacity: 0 } as const

interface ScrollTarget {
  key: string
  index: number
  viewPosition: number
  retries: number
  /** Placed before its row's height was known: put again, once, if the row proves a tall one. */
  unmeasured: boolean
}

interface WebScroller extends WebBox {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  addEventListener: (type: 'scrollend', listener: () => void, options: { once: true }) => void
  removeEventListener: (type: 'scrollend', listener: () => void) => void
}

interface WebBox {
  getBoundingClientRect: () => { top: number; bottom: number }
}

interface WebRow extends WebBox {
  offsetHeight: number
  scrollIntoView: (options: { block: 'start' | 'center'; behavior?: 'smooth' | 'auto' }) => void
}

/**
 * A row whose element and height the list keeps, to scroll to it. Its own component so the ref is
 * one function for the row's life: React detaches and attaches an inline one on every render.
 */
function MeasuredRow({
  rowKey,
  nodes,
  onHeight,
  onGone,
  children,
}: {
  rowKey: string
  nodes: Map<string, unknown>
  onHeight: (key: string, heightPx: number) => void
  onGone: (key: string) => void
  children: ReactNode
}) {
  const attach = useCallback(
    (node: unknown) => {
      if (node === null) nodes.delete(rowKey)
      else nodes.set(rowKey, node)
    },
    [nodes, rowKey],
  )
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      onHeight(rowKey, event.nativeEvent.layout.height)
    },
    [onHeight, rowKey],
  )
  useEffect(
    () => () => {
      onGone(rowKey)
    },
    [onGone, rowKey],
  )
  return (
    <View ref={attach} onLayout={onLayout}>
      {children}
    </View>
  )
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
  /** Scrolls the list from outside. Rows are then measured, which is what places a tall one. */
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
  /** The keys of the rows drawn inside the viewport, each time that set changes. */
  onRowsOnScreen?: ((keys: ReadonlySet<string>) => void) | undefined
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
  onRowsOnScreen,
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
  const rowHeights = useRef(new Map<string, number>())
  const rowNodes = useRef(new Map<string, unknown>())
  const onScreen = useRef<{ first: number; last: number } | null>(null)
  const target = useRef<ScrollTarget | null>(null)
  // On its way to the end, by `scrollToEnd`: an animated scroll reports every offset it passes,
  // none of them the end, and the rows drawn as it nears change where the end is.
  const seekingEnd = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // The first pass alone draws every row. FlatList keeps its first `initialNumToRender` rows
  // mounted for good, so a count that followed the data would mount every page ever read.
  const [firstPassRows] = useState(() => Math.max(data.length, 1))
  // A list that opens at its end is not shown until it is there.
  const [placed, setPlaced] = useState(!startsAtEnd)

  const latest = useRef({ keys, onStartReached, onFarFromEnd, onRowsOnScreen })
  useLayoutEffect(() => {
    latest.current = { keys, onStartReached, onFarFromEnd, onRowsOnScreen }
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
      // Coming back to the start asks again: a page that failed left the height as it was.
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
      const reachesEnd =
        contentSize.height - contentOffset.y - layoutMeasurement.height <= AT_END_SLACK_PX
      if (reachesEnd) {
        clearTimeout(seekingEnd.current)
        seekingEnd.current = undefined
      }
      if (resized && atEnd.current) followEnd()
      else if (seekingEnd.current === undefined) atEnd.current = startsAtEnd && reachesEnd
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

  const scrollToTarget = useCallback((animated: boolean) => {
    const at = target.current
    if (at === null) return
    list.current?.scrollToIndex({ index: at.index, viewPosition: at.viewPosition, animated })
  }, [])

  // A row not measured yet has no offset to scroll to: go to roughly where it is, which
  // measures it, then try again.
  const onScrollToIndexFailed = useCallback(
    (info: { index: number; averageItemLength: number }) => {
      const at = target.current
      if (at === null || at.retries >= SCROLL_RETRIES) return
      at.retries += 1
      list.current?.scrollToOffset({
        offset: info.averageItemLength * info.index,
        animated: false,
      })
      setTimeout(() => {
        scrollToTarget(false)
      }, SCROLL_RETRY_MS)
    },
    [scrollToTarget],
  )

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: { index?: number | null | undefined }[] }) => {
      const indices = viewableItems.flatMap(({ index }) =>
        typeof index === 'number' ? [index] : [],
      )
      onScreen.current =
        indices.length === 0 ? null : { first: Math.min(...indices), last: Math.max(...indices) }
      const report = latest.current.onRowsOnScreen
      if (report === undefined) return
      const all = latest.current.keys
      report(new Set(indices.flatMap((index) => all[index] ?? [])))
    },
    [],
  )

  /**
   * The web's scroll to a row, by the row's own element: rows just handed to the list have no
   * measurements for the list to scroll by, and the page knows where they are.
   */
  const scrollToRowElement = useCallback(
    (key: string, animated: boolean, onArrived: (() => void) | undefined) => {
      let frames = 0
      const step = () => {
        frames += 1
        const node = rowNodes.current.get(key) as WebRow | undefined
        const scroller = webScroller()
        if (node === undefined || scroller === null) {
          // Not drawn yet: towards where the list reckons it is, which draws it.
          scrollToTarget(false)
          if (frames < ROW_FRAMES) requestAnimationFrame(step)
          return
        }
        const block = node.offsetHeight > scroller.clientHeight ? 'start' : 'center'
        const row = node.getBoundingClientRect()
        const box = scroller.getBoundingClientRect()
        const awayPx = Math.abs((row.top + row.bottom) / 2 - (box.top + box.bottom) / 2)
        const smooth = animated && awayPx <= box.bottom - box.top
        if (smooth && onArrived !== undefined) {
          // Whichever comes first: a row already in place scrolls nowhere and ends no scroll.
          let arrived = false
          const arrive = () => {
            if (arrived) return
            arrived = true
            scroller.removeEventListener('scrollend', arrive)
            onArrived()
          }
          scroller.addEventListener('scrollend', arrive, { once: true })
          setTimeout(arrive, ANIMATED_SCROLL_MS)
        }
        node.scrollIntoView({ block, behavior: smooth ? 'smooth' : 'auto' })
        if (!smooth && onArrived !== undefined) requestAnimationFrame(onArrived)
      }
      step()
    },
    [scrollToTarget, webScroller],
  )

  useImperativeHandle(
    handle,
    (): ListHandle => ({
      scrollToKey(key, { animated = false, focus: focusRow = false, onArrived } = {}) {
        const index = latest.current.keys.indexOf(key)
        if (index === -1) return
        atEnd.current = false
        clearTimeout(seekingEnd.current)
        seekingEnd.current = undefined
        const heightPx = rowHeights.current.get(key)
        const tall = heightPx !== undefined && heightPx > scroll.current.viewportPx
        target.current = {
          key,
          index,
          viewPosition: tall ? 0 : 0.5,
          retries: 0,
          unmeasured: heightPx === undefined,
        }
        if (isWeb) scrollToRowElement(key, animated, onArrived)
        else {
          const shown = onScreen.current
          const near =
            shown !== null && index >= shown.first - NEAR_ROWS && index <= shown.last + NEAR_ROWS
          scrollToTarget(animated && near)
          // Native reports no end of a scroll it was told to make, animated or not.
          if (onArrived !== undefined)
            setTimeout(onArrived, animated && near ? ANIMATED_SCROLL_MS : SCROLL_RETRY_MS * 2)
        }
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
        atEnd.current = startsAtEnd
        target.current = null
        clearTimeout(seekingEnd.current)
        seekingEnd.current = setTimeout(() => {
          seekingEnd.current = undefined
        }, SEEK_END_MS)
        toEnd(animated)
      },
    }),
    [focus, scrollToTarget, scrollToRowElement, startsAtEnd, toEnd],
  )

  const measured = handle !== undefined

  const onRowHeight = useCallback(
    (key: string, heightPx: number) => {
      rowHeights.current.set(key, heightPx)
      // Native places by index and a guess at where in the list the row should sit. The web
      // scrolls to the row's own element, which knows its height.
      const at = target.current
      if (isWeb || at === null || at.key !== key || !at.unmeasured) return
      at.unmeasured = false
      if (heightPx <= scroll.current.viewportPx) return
      at.viewPosition = 0
      scrollToTarget(false)
    },
    [scrollToTarget],
  )
  const onRowGone = useCallback((key: string) => {
    rowHeights.current.delete(key)
  }, [])
  // The reader has taken the scroll: a height that arrives now must not move it.
  const onScrollBeginDrag = useCallback(() => {
    if (target.current !== null) target.current.unmeasured = false
  }, [])

  useLayoutEffect(() => {
    if (focus !== null) focus.rowMenu = onRowMenu ?? null
  }, [focus, onRowMenu])

  const renderRow = useCallback(
    ({ item, index }: { item: T; index: number }) => {
      const key = keyExtractor(item, index)
      const row = measured ? (
        <MeasuredRow
          rowKey={key}
          nodes={rowNodes.current}
          onHeight={onRowHeight}
          onGone={onRowGone}
        >
          {renderItem(item, index)}
        </MeasuredRow>
      ) : (
        renderItem(item, index)
      )
      return focus === null ? row : <ListRowKey.Provider value={key}>{row}</ListRowKey.Provider>
    },
    [focus, measured, renderItem, keyExtractor, onRowHeight, onRowGone],
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
  useEffect(
    () => () => {
      clearTimeout(seekingEnd.current)
    },
    [],
  )

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
      {...(measured
        ? {
            onScrollToIndexFailed,
            onViewableItemsChanged,
            viewabilityConfig: VIEWABILITY,
            onScrollBeginDrag,
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
