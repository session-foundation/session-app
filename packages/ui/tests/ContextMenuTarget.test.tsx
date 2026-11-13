import { fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ContextMenuTarget } from '#src/ContextMenuTarget'
import { PressArea } from '#src/PressArea'
import { Text } from '#src/Text'

import { renderInUI } from './support/render'

/** A message with words and a control of its own, as one with a quote or a file has. */
function target(onDoublePress: (() => void) | undefined) {
  return renderInUI(
    <ContextMenuTarget onOpen={() => {}} onDoublePress={onDoublePress}>
      <Text testID="words">Are we still on for Thursday?</Text>
      <PressArea onPress={() => {}} accessibilityLabel="Download" testID="control">
        {() => <Text>Download</Text>}
      </PressArea>
    </ContextMenuTarget>,
  )
}

/** What the browser does with a double-click's second press: selects the text under it. */
function select(node: Node, start?: number, end?: number): void {
  const range = document.createRange()
  if (start === undefined || end === undefined) range.selectNodeContents(node)
  else {
    range.setStart(node, start)
    range.setEnd(node, end)
  }
  const selection = getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

describe('a double-click on a message', () => {
  it('on its words selects the word, and is not reported', () => {
    const onDoublePress = vi.fn()
    const { getByTestId } = target(onDoublePress)
    const words = getByTestId('words')

    // True from fireEvent: the press is left to the browser, which selects the word.
    expect(fireEvent.mouseDown(words, { detail: 2 })).toBe(true)
    select(words)
    fireEvent.doubleClick(words)

    expect(onDoublePress).not.toHaveBeenCalled()
    getSelection()?.removeAllRanges()
  })

  it('off its words is reported: nothing selected, or only whitespace', () => {
    const onDoublePress = vi.fn()
    const { getByTestId } = target(onDoublePress)
    const words = getByTestId('words')

    getSelection()?.removeAllRanges()
    fireEvent.doubleClick(words)
    // "Are we": the space between the two words.
    const text = words.firstChild
    if (text === null) throw new Error('the words have no text node')
    select(text, 3, 4)
    fireEvent.doubleClick(words)

    expect(onDoublePress).toHaveBeenCalledTimes(2)
    getSelection()?.removeAllRanges()
  })

  it('is the control’s when it lands on one inside the message', () => {
    const onDoublePress = vi.fn()
    const { getByTestId } = target(onDoublePress)
    fireEvent.doubleClick(getByTestId('control'))
    expect(onDoublePress).not.toHaveBeenCalled()
  })
})
