import { fireEvent } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { byId } from '@session/render-tier'
import { ELEMENT } from '@session/test-ids'

import { Text } from '#src/Text'
import { TranscriptList, type TranscriptListHandle } from '#src/TranscriptList'

import { renderInUI } from './support/render'

// The native half as a phone has it: a finger is the only scroll known to be the reader's, and
// none has touched the list.
vi.mock('#src/transcriptPlatform', () => ({
  useTranscriptPlatform: ({ firstPassRows }: { firstPassRows: number }) => ({
    listProps: { initialNumToRender: firstPassRows },
    readerScrolled: () => false,
    untouched: () => true,
    startViewports: 2,
    pinsEdges: true,
  }),
}))

const LIST = ELEMENT.conversation.screen
const ROW = ELEMENT.conversation.messageRow
/** Past the moment after a resize in which a scroll is taken for the list's own. */
const AFTER_RESIZE_MS = 400

interface Item {
  id: string
}

const paged = (count: number): Item[] =>
  Array.from({ length: count }, (_, index) => ({ id: `m${String(index)}` }))

/** Scrolls the list to `scrollTop` in a 400 px viewport over `scrollHeight` of content. */
async function scrollTo(scrollTop: number, scrollHeight: number): Promise<void> {
  const scroller = byId(LIST)
  for (const [name, value] of Object.entries({
    scrollTop,
    scrollHeight,
    offsetHeight: 400,
    clientHeight: 400,
  }))
    Object.defineProperty(scroller, name, { configurable: true, writable: true, value })
  fireEvent.scroll(scroller)
  await new Promise((resolve) => setTimeout(resolve, 20))
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

afterEach(() => {
  vi.useRealTimers()
})

describe('TranscriptList, scrolled by no finger', () => {
  it('takes a screen reader’s scroll for the reader’s: it stays, and asks for the page above', async () => {
    const onStartReached = vi.fn()
    renderInUI(
      <TranscriptList
        data={paged(15)}
        keyExtractor={(item) => item.id}
        onStartReached={onStartReached}
        testID={LIST}
        renderItem={(item, index) => <Text testID={ROW(index)}>{item.id}</Text>}
      />,
    )
    // Opened at its end and laid out.
    await scrollTo(1600, 2000)
    await wait(AFTER_RESIZE_MS)
    expect(onStartReached).not.toHaveBeenCalled()

    // A screen reader scrolls it up, with no drag: the list must not put it back at the end.
    await scrollTo(600, 2000)
    expect(byId(LIST).scrollTop).toBe(600)
    expect(onStartReached).toHaveBeenCalledTimes(1)

    // A row arriving at the end does not pull the reader down to it.
    await scrollTo(600, 2100)
    expect(byId(LIST).scrollTop).toBe(600)

    await wait(150)
  })

  it('takes a scroll right after rows changed size for the list keeping its place', async () => {
    renderInUI(
      <TranscriptList
        data={paged(15)}
        keyExtractor={(item) => item.id}
        testID={LIST}
        renderItem={(item, index) => <Text testID={ROW(index)}>{item.id}</Text>}
      />,
    )
    await scrollTo(1600, 2000)
    await wait(AFTER_RESIZE_MS)
    // Rows above grew and the list moved itself by them, ending short of the end for a moment.
    await scrollTo(1650, 2100)
    await scrollTo(1640, 2100)
    // Still following the end: the next row draws it down.
    await scrollTo(1640, 2200)
    expect(byId(LIST).scrollTop).not.toBe(1640)

    await wait(150)
  })
})

describe('TranscriptList, sent to its end', () => {
  // jsdom scrolls nothing: what the list asks of its scroller is the test's.
  const scroll = vi.fn()
  afterEach(() => {
    Reflect.deleteProperty(Element.prototype, 'scroll')
    Reflect.deleteProperty(Element.prototype, 'scrollTo')
    scroll.mockReset()
  })

  function List({ handle }: { handle: React.Ref<TranscriptListHandle> }) {
    return (
      <TranscriptList
        data={paged(15)}
        keyExtractor={(item) => item.id}
        handle={handle}
        testID={LIST}
        renderItem={(item, index) => <Text testID={ROW(index)}>{item.id}</Text>}
      />
    )
  }

  it('jumps to a list height from the end first, from many pages back, and animates the rest', async () => {
    const handle = createRef<TranscriptListHandle>()
    renderInUI(<List handle={handle} />)
    await scrollTo(0, 20_000)
    Element.prototype.scroll = scroll
    Element.prototype.scrollTo = scroll

    handle.current?.scrollToEnd({ animated: true })

    const moves = scroll.mock.calls.map(([to]) => to as { top: number; behavior: string })
    expect(moves[0]).toMatchObject({ top: 20_000 - 800, behavior: 'auto' })
    expect(moves.at(-1)).toMatchObject({ behavior: 'smooth' })
    await wait(150)
  })

  it('animates all the way from within two list heights', async () => {
    const handle = createRef<TranscriptListHandle>()
    renderInUI(<List handle={handle} />)
    await scrollTo(19_000, 20_000)
    Element.prototype.scroll = scroll
    Element.prototype.scrollTo = scroll

    handle.current?.scrollToEnd({ animated: true })

    const moves = scroll.mock.calls.map(([to]) => to as { behavior: string })
    expect(moves.map((to) => to.behavior)).toEqual(['smooth'])
    await wait(150)
  })
})

describe('TranscriptList, with something to say past its start', () => {
  it('pins it over the top edge while the start is in reach, outside the scrolled rows', async () => {
    renderInUI(
      <TranscriptList
        data={paged(15)}
        keyExtractor={(item) => item.id}
        testID={LIST}
        header={<Text testID="past-start">loading</Text>}
        renderItem={(item, index) => <Text testID={ROW(index)}>{item.id}</Text>}
      />,
    )
    await scrollTo(1600, 2000)
    await wait(AFTER_RESIZE_MS)
    expect(document.querySelector('[data-testid="past-start"]')).toBeNull()

    // Within two list heights of the start.
    await scrollTo(600, 2000)
    const pinned = document.querySelector('[data-testid="past-start"]')
    expect(pinned).not.toBeNull()
    expect(byId(LIST).contains(pinned)).toBe(false)

    await scrollTo(1500, 2000)
    expect(document.querySelector('[data-testid="past-start"]')).toBeNull()
    await wait(150)
  })
})
