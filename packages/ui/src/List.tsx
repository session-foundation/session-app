import { useCallback, useMemo } from 'react'
import { FlatList } from 'react-native'

import { SPACING } from '@session/theme-tokens'

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
}

const FILLS = { flex: 1 } as const
const FITS_CONTENT = { flexGrow: 0, flexShrink: 1 } as const

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
}: ListProps<T>) {
  const renderRow = useCallback(
    ({ item, index }: { item: T; index: number }) => renderItem(item, index),
    [renderItem],
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

  return (
    <FlatList
      style={fitsContent ? FITS_CONTENT : FILLS}
      {...(contentContainerStyle === undefined ? {} : { contentContainerStyle })}
      data={data}
      renderItem={renderRow}
      keyExtractor={keyExtractor}
      {...(itemHeight === undefined ? {} : { getItemLayout })}
      {...(empty === undefined ? {} : { ListEmptyComponent: empty })}
      {...(header === undefined ? {} : { ListHeaderComponent: header })}
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
}
