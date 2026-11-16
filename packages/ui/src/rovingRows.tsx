import { useCallback, useLayoutEffect, useState, type ReactElement } from 'react'
import { isWeb } from 'tamagui'

import {
  ListFocus,
  ListFocusContext,
  ListRowKey,
  type ListFocusEntry,
  type ListRowMenu,
} from './listFocus'

/** What makes a list one tab stop on the desktop, with Up and Down moving between its rows. */
export interface RovingRowsProps {
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
}

/**
 * The roving focus a list's rows share: the focus itself (null without `rovingFocus`, and on
 * native), each row drawn under its key, and the list drawn under the focus.
 */
export function useRovingRows<T>({
  rovingFocus,
  onRowMenu,
  inverted,
  data,
  renderItem,
  keyExtractor,
}: RovingRowsProps & {
  inverted: boolean
  data: readonly T[]
  renderItem: (item: T, index: number) => ReactElement | null
  keyExtractor: (item: T, index: number) => string
}) {
  // TODO(#533): keyboard on iPad and the iPad app on Mac. Full Keyboard Access reaches a row only
  // as a full-width accessibility element with the button trait, which hides the row's own
  // controls (they would become custom actions); a bubble-shaped highlight and Up/Down need
  // native code.
  const [focus] = useState(() =>
    rovingFocus === undefined || !isWeb ? null : new ListFocus(rovingFocus, inverted),
  )

  useLayoutEffect(() => {
    focus?.setKeys(data.map(keyExtractor))
  }, [focus, data, keyExtractor])

  useLayoutEffect(() => {
    if (focus !== null) focus.rowMenu = onRowMenu ?? null
  }, [focus, onRowMenu])

  const renderRow = useCallback(
    ({ item, index }: { item: T; index: number }) =>
      focus === null ? (
        renderItem(item, index)
      ) : (
        <ListRowKey.Provider value={keyExtractor(item, index)}>
          {renderItem(item, index)}
        </ListRowKey.Provider>
      ),
    [focus, renderItem, keyExtractor],
  )

  const withFocus = (list: ReactElement) =>
    focus === null ? (
      list
    ) : (
      <ListFocusContext.Provider value={focus}>{list}</ListFocusContext.Provider>
    )

  return { focus, renderRow, withFocus }
}
