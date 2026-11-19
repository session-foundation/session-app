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

const LIST = ELEMENT.conversation.screen
const ROW = ELEMENT.conversation.messageRow

interface Item {
  id: string
}

/** `m{from}` to `m{to}`. */
const rows = (from: number, to: number): Item[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ id: `m${String(from + i)}` }))

/** Says rows `first` to `last` of `held` are on screen, as FlatList does once it has laid out. */
function report(held: readonly Item[], first: number, last: number): void {
  const viewableItems = held
    .slice(first, last + 1)
    .map((item, i) => ({ item, key: item.id, index: first + i, isViewable: true }))
  act(() => {
    flatList.props?.onViewableItemsChanged?.({ viewableItems, changed: viewableItems })
  })
}

function Transcript({ held, onStartReached }: { held: Item[]; onStartReached: () => void }) {
  return (
    <TranscriptList
      data={held}
      keyExtractor={(item) => item.id}
      onStartReached={onStartReached}
      moreBefore
      testID={LIST}
      renderItem={(item, index) => <Text testID={ROW(index)}>{item.id}</Text>}
    />
  )
}

describe('TranscriptList, paged by the rows on screen', () => {
  it('asks for one page above, and not again for the rows reported before the reader’s are back', () => {
    const onStartReached = vi.fn()
    const window = rows(60, 89)
    const { rerender } = renderInUI(<Transcript held={window} onStartReached={onStartReached} />)
    report(window, 2, 10)
    expect(onStartReached).toHaveBeenCalledTimes(1)

    // The page lands above. Native puts the reader's rows back a frame or more later, and reports
    // the page's own rows, at the start, meanwhile.
    const landed = [...rows(30, 59), ...window]
    rerender(<Transcript held={landed} onStartReached={onStartReached} />)
    report(landed, 0, 8)
    expect(onStartReached).toHaveBeenCalledTimes(1)

    // Back on the reader's rows, a page past the start.
    report(landed, 32, 40)
    expect(onStartReached).toHaveBeenCalledTimes(1)

    // Going on up into the page that landed asks for the next.
    report(landed, 5, 13)
    expect(onStartReached).toHaveBeenCalledTimes(2)
  })
})
