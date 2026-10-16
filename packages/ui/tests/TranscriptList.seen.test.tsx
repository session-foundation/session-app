import { act } from '@testing-library/react'
import type * as ReactNative from 'react-native'
import type { FlatListProps } from 'react-native'
import { describe, expect, it, vi } from 'vitest'

import { ELEMENT } from '@session/test-ids'

import { Text } from '#src/Text'
import { TranscriptList } from '#src/TranscriptList'

import { renderInUI } from './support/render'

/** The props the list last gave its FlatList: jsdom lays nothing out, so the test reports rows. */
const flatList: { props?: FlatListProps<Item> } = {}

vi.mock('react-native', async (importOriginal) => {
  const rn = await importOriginal<typeof ReactNative>()
  const { createElement, forwardRef } = await import('react')
  const FlatList = forwardRef((props: FlatListProps<Item>, ref) => {
    flatList.props = props
    return createElement(rn.FlatList as never, { ...props, ref })
  })
  return { ...rn, FlatList }
})

interface Item {
  id: string
}

type Report = (info: { viewableItems: unknown[]; changed: unknown[] }) => void

/** Says which rows of `held` are on screen at all (the first pair) or wholly (the second). */
function report(held: readonly Item[], pair: 0 | 1, first: number, last: number): void {
  const viewableItems = held
    .slice(first, last + 1)
    .map((item, i) => ({ item, key: item.id, index: first + i, isViewable: true }))
  const pairs = flatList.props?.viewabilityConfigCallbackPairs as
    { onViewableItemsChanged?: Report }[] | undefined
  act(() => {
    pairs?.[pair]?.onViewableItemsChanged?.({ viewableItems, changed: viewableItems })
  })
}

describe('TranscriptList, telling which rows have been seen', () => {
  it('counts a row seen once its bottom edge is on screen', () => {
    const held = Array.from({ length: 10 }, (_, i) => ({ id: `m${String(i)}` }))
    const onRowsSeen = vi.fn<(keys: readonly string[]) => void>()
    renderInUI(
      <TranscriptList
        data={held}
        keyExtractor={(item) => item.id}
        onRowsSeen={onRowsSeen}
        testID={ELEMENT.conversation.screen}
        renderItem={(item, index) => (
          <Text testID={ELEMENT.conversation.messageRow(index)}>{item.id}</Text>
        )}
      />,
    )
    // Scrolled to the top of more than a screenful: not at the end, where every row counts.
    act(() => {
      flatList.props?.onLayout?.({ nativeEvent: { layout: { height: 500 } } } as never)
      flatList.props?.onContentSizeChange?.(0, 2000)
    })
    // Rows 2 to 5 showing, the last cut off at its foot: its bottom has not been on screen.
    report(held, 0, 2, 5)
    report(held, 1, 2, 4)
    expect(onRowsSeen).toHaveBeenLastCalledWith(['m2', 'm3', 'm4'])

    // Scrolled on, row 5 wholly showing.
    report(held, 1, 3, 5)
    expect(onRowsSeen).toHaveBeenLastCalledWith(['m2', 'm3', 'm4', 'm5'])
  })
})
