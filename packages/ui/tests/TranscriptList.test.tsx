import { fireEvent } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { byId } from '@session/render-tier'
import { ELEMENT } from '@session/test-ids'

import { Text } from '#src/Text'
import { TranscriptList, type TranscriptListHandle } from '#src/TranscriptList'

import { renderInUI } from './support/render'

const ROW = ELEMENT.conversation.messageRow

interface Item {
  id: string
}

const key = (item: Item) => item.id

/** Past the moment after a resize in which a scroll is taken for the list's own. */
const AFTER_RESIZE_MS = 400

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('TranscriptList', () => {
  const LIST = ELEMENT.conversation.screen
  /** Past the 100 ms after its last event at which react-native-web calls a scroll ended. */
  const SCROLL_END_MS = 150
  const paged = (count: number): Item[] =>
    Array.from({ length: count }, (_, index) => ({ id: `m${String(index)}` }))

  function Paged({ data, onStartReached }: { data: readonly Item[]; onStartReached?: () => void }) {
    return (
      <TranscriptList
        data={data}
        keyExtractor={key}
        onStartReached={onStartReached}
        testID={LIST}
        renderItem={(item, index) => <Text testID={ROW(index)}>{item.id}</Text>}
      />
    )
  }

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
    // Past the scroller's own throttle, so the next event is reported too.
    await new Promise((resolve) => setTimeout(resolve, 20))
  }

  it('draws every row on the first pass, and no more than that many for good', () => {
    const { rerender } = renderInUI(<Paged data={paged(12)} />)
    expect(document.querySelectorAll('[data-testid^="message-row-"]')).toHaveLength(12)
    rerender(<Paged data={paged(200)} />)
    expect(document.querySelectorAll('[data-testid^="message-row-"]').length).toBeLessThan(200)
  })

  it('asks for the page before its start once per first row, and again on coming back to it', async () => {
    const onStartReached = vi.fn()
    const { rerender } = renderInUI(<Paged data={paged(12)} onStartReached={onStartReached} />)
    await scrollTo(0, 2000)
    await scrollTo(10, 2000)
    expect(onStartReached).toHaveBeenCalledTimes(1)

    // What is drawn past the start grows, as Retry does where a spinner was: no page arrived.
    await scrollTo(0, 2060)
    expect(onStartReached).toHaveBeenCalledTimes(1)

    // Leaving the start and coming back asks again.
    await scrollTo(900, 2060)
    await scrollTo(0, 2060)
    expect(onStartReached).toHaveBeenCalledTimes(2)

    // A page that did arrive is a new first row to ask from.
    rerender(<Paged data={[{ id: 'older' }, ...paged(12)]} onStartReached={onStartReached} />)
    await scrollTo(0, 3000)
    expect(onStartReached).toHaveBeenCalledTimes(3)

    // react-native-web ends a scroll on a timer of its own, which must not outlive the page.
    await new Promise((resolve) => setTimeout(resolve, SCROLL_END_MS))
  })
  it('lets a reader who scrolls up on the way to the end stay there when a row arrives', async () => {
    const handle = createRef<TranscriptListHandle>()
    renderInUI(
      <TranscriptList
        data={paged(12)}
        keyExtractor={key}
        handle={handle}
        testID={LIST}
        renderItem={(item, index) => <Text testID={ROW(index)}>{item.id}</Text>}
      />,
    )
    await scrollTo(1000, 2000)
    handle.current?.scrollToEnd({ animated: true })
    await scrollTo(1200, 2000)
    // Up, before the animated scroll got there: the reader's.
    await scrollTo(900, 2000)
    // A row arrives, which would draw a list at its end down to it.
    await scrollTo(900, 2100)
    expect(byId(LIST).scrollTop).toBe(900)

    await new Promise((resolve) => setTimeout(resolve, SCROLL_END_MS))
  })

  describe('asking for the page after its end', () => {
    function Newer({ data, onEndReached }: { data: readonly Item[]; onEndReached: () => void }) {
      return (
        <TranscriptList
          data={data}
          keyExtractor={key}
          onEndReached={onEndReached}
          testID={LIST}
          renderItem={(item, index) => <Text testID={ROW(index)}>{item.id}</Text>}
        />
      )
    }

    it('asks once per last row, on the reader’s scroll, and again once a page has landed', async () => {
      const onEndReached = vi.fn()
      const { rerender } = renderInUI(<Newer data={paged(30)} onEndReached={onEndReached} />)
      await scrollTo(800, 2000)
      await wait(AFTER_RESIZE_MS)
      expect(onEndReached).not.toHaveBeenCalled()

      // Within half a list height of the last row.
      await scrollTo(1450, 2000)
      expect(onEndReached).toHaveBeenCalledTimes(1)
      // Nearer still, and rows growing under it, are not a new page.
      await scrollTo(1550, 2000)
      await scrollTo(1550, 2100)
      await wait(AFTER_RESIZE_MS)
      expect(onEndReached).toHaveBeenCalledTimes(1)

      // A page that lands asks again only at the reader's next scroll near its end.
      rerender(<Newer data={[...paged(30), { id: 'newer' }]} onEndReached={onEndReached} />)
      await scrollTo(1550, 2200)
      await wait(AFTER_RESIZE_MS)
      expect(onEndReached).toHaveBeenCalledTimes(1)
      await scrollTo(1650, 2200)
      expect(onEndReached).toHaveBeenCalledTimes(2)

      await new Promise((resolve) => setTimeout(resolve, SCROLL_END_MS))
    })

    it('asks at the reader’s wheel when they rest at the last row, which scrolls nothing', async () => {
      const onEndReached = vi.fn()
      const { rerender } = renderInUI(<Newer data={paged(30)} onEndReached={onEndReached} />)
      await scrollTo(800, 2000)
      await wait(AFTER_RESIZE_MS)
      await scrollTo(1600, 2000)
      expect(onEndReached).toHaveBeenCalledTimes(1)

      // The page lands with the reader still at the last row: no scroll follows it.
      rerender(<Newer data={[...paged(30), { id: 'newer' }]} onEndReached={onEndReached} />)
      fireEvent.wheel(byId(LIST))
      expect(onEndReached).toHaveBeenCalledTimes(2)

      await new Promise((resolve) => setTimeout(resolve, SCROLL_END_MS))
    })

    it('does not ask while a landing is being placed', async () => {
      Element.prototype.scrollBy = vi.fn()
      const onEndReached = vi.fn()
      const handle = createRef<TranscriptListHandle>()
      renderInUI(
        <TranscriptList
          data={paged(30)}
          keyExtractor={key}
          handle={handle}
          onEndReached={onEndReached}
          testID={LIST}
          renderItem={(item, index) => <Text testID={ROW(index)}>{item.id}</Text>}
        />,
      )
      await scrollTo(800, 2000)
      await wait(AFTER_RESIZE_MS)
      handle.current?.scrollToKey('m28')
      // The rows drawn around the landing leave the scroll at the window's end.
      await scrollTo(1600, 2000)
      expect(onEndReached).not.toHaveBeenCalled()
      Reflect.deleteProperty(Element.prototype, 'scrollBy')

      await new Promise((resolve) => setTimeout(resolve, SCROLL_END_MS))
    })
  })

  describe('landing on a row', () => {
    // jsdom lays nothing out and scrolls nothing: the landing's scroll is the test's.
    const scrollBy = vi.fn()
    const scrollIntoView = vi.fn()
    beforeEach(() => {
      Element.prototype.scrollBy = scrollBy
      Element.prototype.scrollIntoView = scrollIntoView
    })
    afterEach(() => {
      Reflect.deleteProperty(Element.prototype, 'scrollBy')
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
      scrollBy.mockReset()
      scrollIntoView.mockReset()
    })

    function Landed({
      handle,
      onStartReached,
      onAtEnd,
    }: {
      handle: React.Ref<TranscriptListHandle>
      onStartReached?: () => void
      onAtEnd?: () => void
    }) {
      return (
        <TranscriptList
          data={paged(30)}
          keyExtractor={key}
          handle={handle}
          onStartReached={onStartReached}
          onAtEnd={onAtEnd}
          testID={LIST}
          renderItem={(item, index) => <Text testID={ROW(index)}>{item.id}</Text>}
        />
      )
    }

    it('scrolls its own scroller to the row, never the page around it', () => {
      const handle = createRef<TranscriptListHandle>()
      renderInUI(<Landed handle={handle} />)

      handle.current?.scrollToKey('m3')
      expect(scrollBy).toHaveBeenCalledTimes(1)
      expect(scrollBy.mock.contexts[0]).toBe(byId(LIST))
      // scrollIntoView would move every scrolling ancestor, a catalog page or a pane included.
      expect(scrollIntoView).not.toHaveBeenCalled()

      scrollBy.mockClear()
      handle.current?.scrollToKey('m99')
      expect(scrollBy).not.toHaveBeenCalled()
      expect(handle.current?.isOnScreen('m99')).toBe(false)
    })

    it('says the reader is back at the end, which the landing itself never is', async () => {
      const onAtEnd = vi.fn()
      const handle = createRef<TranscriptListHandle>()
      renderInUI(<Landed handle={handle} onAtEnd={onAtEnd} />)
      await scrollTo(1600, 2000)
      expect(onAtEnd).not.toHaveBeenCalled()

      handle.current?.scrollToKey('m25')
      // The rows drawn around the landing leave the scroll at the window's end.
      await scrollTo(1600, 2000)
      expect(onAtEnd).not.toHaveBeenCalled()

      fireEvent.wheel(byId(LIST))
      await scrollTo(1200, 2000)
      await scrollTo(1600, 2000)
      await scrollTo(1600, 2000)
      expect(onAtEnd).toHaveBeenCalledTimes(1)

      await new Promise((resolve) => setTimeout(resolve, SCROLL_END_MS))
    })

    it.each([
      ['a wheel', (scroller: HTMLElement) => fireEvent.wheel(scroller)],
      ['a scroll key', (scroller: HTMLElement) => fireEvent.keyDown(scroller, { key: 'PageUp' })],
      ['the scrollbar', (scroller: HTMLElement) => fireEvent.pointerDown(scroller)],
    ])(
      'asks for no page above while landing, until the reader moves the list by %s',
      async (_by, move) => {
        const onStartReached = vi.fn()
        const handle = createRef<TranscriptListHandle>()
        renderInUI(<Landed handle={handle} onStartReached={onStartReached} />)
        await scrollTo(1600, 2000)
        onStartReached.mockClear()

        handle.current?.scrollToKey('m3')
        // The rows drawn around the landing leave the scroll at the window's start.
        await scrollTo(0, 2000)
        expect(onStartReached).not.toHaveBeenCalled()

        // A key that scrolls nothing is not the reader moving the list.
        fireEvent.keyDown(byId(LIST), { key: 'a' })
        await scrollTo(5, 2000)
        expect(onStartReached).not.toHaveBeenCalled()

        move(byId(LIST))
        await scrollTo(10, 2000)
        expect(onStartReached).toHaveBeenCalledTimes(1)

        await new Promise((resolve) => setTimeout(resolve, SCROLL_END_MS))
      },
    )
  })
})
