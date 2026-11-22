import { act, fireEvent } from '@testing-library/react'
import type * as ReactNative from 'react-native'
import type { FlatListProps } from 'react-native'
import { describe, expect, it, vi } from 'vitest'

import { byId } from '@session/render-tier'
import { ELEMENT } from '@session/test-ids'

import { Text } from '#src/Text'
import { TranscriptList } from '#src/TranscriptList'
import type { TranscriptPlatformInput } from '#src/transcriptPlatform.types'

import { renderInUI } from './support/render'

/** The props the list last gave its FlatList: jsdom lays nothing out, so the test reports rows. */
const flatList: { props?: FlatListProps<Item> } = {}
/** What the list last gave its platform half: how iOS says its scroll to the top has ended. */
const platformInput: { current?: TranscriptPlatformInput } = {}

vi.mock('react-native', async (importOriginal) => {
  const rn = await importOriginal<typeof ReactNative>()
  const { createElement, forwardRef } = await import('react')
  const FlatList = forwardRef((props: FlatListProps<Item>, ref) => {
    flatList.props = props
    return createElement(rn.FlatList as never, { ...props, ref })
  })
  return { ...rn, FlatList }
})

// The native half as iOS has it: a finger is the only scroll known to be the reader's, and a tap
// on the status bar scrolls the list to its top by itself.
vi.mock('#src/transcriptPlatform', () => ({
  useTranscriptPlatform: (input: TranscriptPlatformInput) => {
    platformInput.current = input
    return {
      listProps: { initialNumToRender: input.firstPassRows },
      scrollsToTop: true,
      readerScrolled: () => false,
      untouched: () => false,
      beforeStartAsked: () => undefined,
    }
  },
}))

const LIST = ELEMENT.conversation.screen
const ROW = ELEMENT.conversation.messageRow
/** Past the moment after a resize in which a scroll is taken for the list's own. */
const AFTER_RESIZE_MS = 400

interface Item {
  id: string
}

/** `m{from}` to `m{to}`. */
const rows = (from: number, to: number): Item[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ id: `m${String(from + i)}` }))

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Scrolls the list to `scrollTop` in a 400 px viewport over 2000 px of content. */
async function scrollTo(scrollTop: number): Promise<void> {
  const scroller = byId(LIST)
  for (const [name, value] of Object.entries({
    scrollTop,
    scrollHeight: 2000,
    offsetHeight: 400,
    clientHeight: 400,
  }))
    Object.defineProperty(scroller, name, { configurable: true, writable: true, value })
  fireEvent.scroll(scroller)
  await wait(20)
}

/** Says rows `first` to `last` of `held` are on screen, as FlatList does once it has laid out. */
function report(held: readonly Item[], first: number, last: number): void {
  const viewableItems = held
    .slice(first, last + 1)
    .map((item, i) => ({ item, key: item.id, index: first + i, isViewable: true }))
  act(() => {
    flatList.props?.onViewableItemsChanged?.({ viewableItems, changed: viewableItems })
  })
}

describe('TranscriptList, scrolled to its top by the status bar', () => {
  it('asks for the page above once the scroll has stopped, not on its way there', async () => {
    const onStartReached = vi.fn()
    const window = rows(60, 89)
    renderInUI(
      <TranscriptList
        data={window}
        keyExtractor={(item) => item.id}
        onStartReached={onStartReached}
        moreBefore
        testID={LIST}
        renderItem={(item, index) => <Text testID={ROW(index)}>{item.id}</Text>}
      />,
    )
    await scrollTo(1600)
    await wait(AFTER_RESIZE_MS)

    // Untouched, it heads for the top, past rows within reach of the start.
    await scrollTo(1000)
    report(window, 2, 10)
    expect(onStartReached).not.toHaveBeenCalled()

    act(() => {
      platformInput.current?.onScrolledToTop()
    })
    expect(onStartReached).toHaveBeenCalledTimes(1)
  })
})
