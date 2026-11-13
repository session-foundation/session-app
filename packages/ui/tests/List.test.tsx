import { fireEvent } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { MESSAGE_FRAME } from '@session/expectations'
import { byId, nodeOf } from '@session/render-tier'
import { ELEMENT } from '@session/test-ids'

import { List } from '#src/List'
import { useListTabIndex, type ListFocusEntry } from '#src/listFocus'
import { MessageFrame } from '#src/MessageFrame'
import { PressArea } from '#src/PressArea'
import { Text } from '#src/Text'

import { renderInUI } from './support/render'

const ROW = ELEMENT.conversation.messageRow
const CONTROL = ELEMENT.conversation.messageRetry

interface Item {
  id: string
  /** Carries a control of its own, as a message with a file does. */
  control?: boolean
}

/** Renders of each row's own subscription, by item id; its parent's renders are not counted. */
const renders = new Map<string, number>()

function RenderCount({ id }: { id: string }) {
  useListTabIndex()
  renders.set(id, (renders.get(id) ?? 0) + 1)
  return null
}

const items = (...ids: string[]): Item[] => ids.map((id) => ({ id, control: id === 'c' }))
const key = (item: Item) => item.id

function Transcript({
  data,
  rovingFocus = 'last',
  onRowMenu,
}: {
  data: readonly Item[]
  rovingFocus?: ListFocusEntry | null
  onRowMenu?: (key: string, row: unknown) => void
}) {
  return (
    <List
      data={data}
      keyExtractor={key}
      rovingFocus={rovingFocus ?? undefined}
      onRowMenu={onRowMenu}
      renderItem={(item, index) => (
        <MessageFrame outgoing={false} focusable testID={ROW(index)}>
          <Text>{item.id}</Text>
          <RenderCount id={item.id} />
          {item.control === true ? (
            <PressArea onPress={() => {}} accessibilityLabel="Download" testID={CONTROL}>
              {() => <Text>Download</Text>}
            </PressArea>
          ) : null}
        </MessageFrame>
      )}
    />
  )
}

const tabIndexes = (count: number) =>
  Array.from({ length: count }, (_, index) => byId(ROW(index)).getAttribute('tabindex'))

describe('List with roving focus', () => {
  it('is one tab stop, on the last row until one is focused', () => {
    renderInUI(<Transcript data={items('a', 'b', 'c', 'd')} />)
    expect(tabIndexes(4)).toEqual(['-1', '-1', '-1', '0'])
    expect(nodeOf(ROW(3))).toMatchObject(MESSAGE_FRAME.desktop)
  })

  it('enters on the first row when asked to', () => {
    renderInUI(<Transcript data={items('a', 'b', 'c')} rovingFocus="first" />)
    expect(tabIndexes(3)).toEqual(['0', '-1', '-1'])
  })

  it('moves focus and the stop with Up and Down, and stops at either end', async () => {
    const user = userEvent.setup()
    renderInUI(<Transcript data={items('a', 'b', 'c')} />)
    await user.tab()
    expect(document.activeElement).toBe(byId(ROW(2)))
    await user.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(byId(ROW(1)))
    expect(tabIndexes(3)).toEqual(['-1', '0', '-1'])
    await user.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}')
    expect(document.activeElement).toBe(byId(ROW(0)))
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}')
    expect(document.activeElement).toBe(byId(ROW(2)))
  })

  it('re-renders only the two rows whose stop changes when it moves', async () => {
    const user = userEvent.setup()
    renderInUI(<Transcript data={items('a', 'b', 'c', 'd')} />)
    await user.tab()
    renders.clear()
    await user.keyboard('{ArrowUp}')
    expect(Object.fromEntries(renders)).toEqual({ c: 1, d: 1 })
  })

  it('leaves Up and Down with a modifier alone', () => {
    renderInUI(<Transcript data={items('a', 'b')} />)
    byId(ROW(1)).focus()
    fireEvent.keyDown(byId(ROW(1)), { key: 'ArrowUp', shiftKey: true })
    expect(document.activeElement).toBe(byId(ROW(1)))
  })

  it('reaches a row’s controls only while that row is the stop', async () => {
    const user = userEvent.setup()
    renderInUI(<Transcript data={items('b', 'c', 'd')} />)
    expect(byId(CONTROL).getAttribute('tabindex')).toBe('-1')
    await user.tab()
    await user.keyboard('{ArrowUp}')
    expect(byId(CONTROL).getAttribute('tabindex')).toBe('0')
    await user.tab()
    expect(document.activeElement).toBe(byId(CONTROL))
    await user.tab()
    expect(document.activeElement).toBe(document.body)
  })

  it('moves for the row from a control inside it, and a click inside makes that row the stop', async () => {
    const user = userEvent.setup()
    renderInUI(<Transcript data={items('b', 'c', 'd')} />)
    await user.click(byId(CONTROL))
    expect(tabIndexes(3)).toEqual(['-1', '0', '-1'])
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(byId(ROW(2)))
  })

  it('keeps the focused row as rows arrive, and goes back to the last when it is removed', () => {
    const { rerender } = renderInUI(<Transcript data={items('a', 'b')} />)
    byId(ROW(0)).focus()
    rerender(<Transcript data={items('a', 'b', 'c')} />)
    expect(tabIndexes(3)).toEqual(['0', '-1', '-1'])
    rerender(<Transcript data={items('b', 'c')} />)
    expect(tabIndexes(2)).toEqual(['-1', '0'])
  })

  it('follows the newest row while none has been focused', () => {
    const { rerender } = renderInUI(<Transcript data={items('a', 'b')} />)
    rerender(<Transcript data={items('a', 'b', 'c')} />)
    expect(tabIndexes(3)).toEqual(['-1', '-1', '0'])
  })

  it.each([
    ['the Menu key', { key: 'ContextMenu' }],
    ['Shift+F10', { key: 'F10', shiftKey: true }],
  ])('opens the row’s menu on %s, from the row or inside it', (_, keys) => {
    const onRowMenu = vi.fn()
    renderInUI(<Transcript data={items('b', 'c')} onRowMenu={onRowMenu} />)
    expect(fireEvent.keyDown(byId(ROW(1)), keys)).toBe(false)
    fireEvent.keyDown(byId(CONTROL), keys)
    expect(onRowMenu.mock.calls).toEqual([
      ['c', byId(ROW(1))],
      ['c', byId(ROW(1))],
    ])
  })

  it.each([
    ['Enter', { key: 'Enter' }],
    ['Space', { key: ' ' }],
  ])('opens the row’s menu on %s on the row only, leaving it to a control inside', (_, keys) => {
    const onRowMenu = vi.fn()
    renderInUI(<Transcript data={items('b', 'c')} onRowMenu={onRowMenu} />)
    expect(fireEvent.keyDown(byId(ROW(1)), keys)).toBe(false)
    // The control presses itself; the menu is not asked for.
    fireEvent.keyDown(byId(CONTROL), keys)
    expect(fireEvent.keyDown(byId(ROW(1)), { ...keys, ctrlKey: true })).toBe(true)
    // Held, it opens the menu once, not again on each repeat.
    fireEvent.keyDown(byId(ROW(1)), { ...keys, repeat: true })
    expect(onRowMenu.mock.calls).toEqual([['c', byId(ROW(1))]])
  })

  it('takes no stop and no keys without roving focus', () => {
    renderInUI(<Transcript data={items('a', 'b', 'c')} rovingFocus={null} />)
    expect(tabIndexes(3)).toEqual([null, null, null])
    expect(byId(CONTROL).getAttribute('tabindex')).toBe('0')
  })
})

describe('List that starts at its end', () => {
  const LIST = ELEMENT.conversation.screen
  const paged = (count: number): Item[] =>
    Array.from({ length: count }, (_, index) => ({ id: `m${String(index)}` }))

  function Paged({ data, onStartReached }: { data: readonly Item[]; onStartReached?: () => void }) {
    return (
      <List
        data={data}
        keyExtractor={key}
        startsAtEnd
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
      Object.defineProperty(scroller, name, { configurable: true, value })
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

  it('asks for the page before its start once per height, and again on coming back to it', async () => {
    const onStartReached = vi.fn()
    renderInUI(<Paged data={paged(12)} onStartReached={onStartReached} />)
    await scrollTo(0, 2000)
    await scrollTo(10, 2000)
    expect(onStartReached).toHaveBeenCalledTimes(1)

    // The page never arrived, so the height is what it was: leaving and returning asks again.
    await scrollTo(900, 2000)
    await scrollTo(0, 2000)
    expect(onStartReached).toHaveBeenCalledTimes(2)

    // A page that did arrive is a new height to ask from.
    await scrollTo(0, 3000)
    expect(onStartReached).toHaveBeenCalledTimes(3)
  })
})
