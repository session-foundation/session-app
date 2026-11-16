import { userEvent } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { MESSAGE_QUOTE_ID, messageQuote } from '@session/expectations'

import { MessageQuote, type MessageQuoteProps } from '#src/MessageQuote'
import { QUOTE_LABELS } from '#src/catalog/quoteLabels'

import { byId, nodeOf } from '@session/render-tier'
import { renderInUI } from './support/render'

const HINT = 'Shows the original message'

function quote(over: Partial<MessageQuoteProps> = {}): MessageQuoteProps {
  return {
    author: 'Bob',
    message: {
      id: 3,
      outgoing: false,
      body: '',
      attachments: [{ contentType: 'image/jpeg', voiceMessage: false }],
    },
    labels: QUOTE_LABELS,
    onAccent: false,
    onPress: () => {},
    hint: HINT,
    testID: MESSAGE_QUOTE_ID,
    ...over,
  }
}

describe('a quote, as a screen reader reaches it on the desktop', () => {
  it('is one button named by its author and summary, the picture’s words in it', () => {
    renderInUI(<MessageQuote {...quote()} />)
    expect(nodeOf(MESSAGE_QUOTE_ID)).toMatchObject(
      messageQuote({ name: 'Bob: Image', hint: HINT, pressable: true }).desktop!,
    )
  })

  it('is busy while the original is read in', () => {
    renderInUI(<MessageQuote {...quote({ busy: true })} />)
    expect(nodeOf(MESSAGE_QUOTE_ID)).toMatchObject(
      messageQuote({ name: 'Bob: Image', hint: HINT, pressable: true, busy: true }).desktop!,
    )
  })

  it.each([
    ['never received', undefined],
    ['deleted', { id: 3, outgoing: false, body: 'Gone', attachments: [], deleted: true }],
  ])('says only that it is not found, and is no button, for an original %s', (_why, message) => {
    renderInUI(<MessageQuote {...quote({ message })} />)
    expect(nodeOf(MESSAGE_QUOTE_ID)).toMatchObject(
      messageQuote({ name: 'Bob: Original message not found', hint: null, pressable: false })
        .desktop!,
    )
    expect(byId(MESSAGE_QUOTE_ID).textContent).toBe('BobOriginal message not found')
  })

  it('is no button where nothing is offered a press', () => {
    renderInUI(<MessageQuote {...quote({ onPress: undefined })} />)
    expect(byId(MESSAGE_QUOTE_ID).getAttribute('role')).toBeNull()
  })
})

describe('a press on a quote', () => {
  it('jumps, by the pointer or by the keyboard', async () => {
    const user = userEvent.setup()
    const onPress = vi.fn()
    renderInUI(<MessageQuote {...quote({ onPress })} />)
    await user.click(byId(MESSAGE_QUOTE_ID))
    byId(MESSAGE_QUOTE_ID).focus()
    await user.keyboard('{Enter}')
    expect(onPress).toHaveBeenCalledTimes(2)
  })

  it('still reaches the caller on one not found, for the toast that says so', async () => {
    const user = userEvent.setup()
    const onPress = vi.fn()
    renderInUI(<MessageQuote {...quote({ onPress, message: undefined })} />)
    await user.click(byId(MESSAGE_QUOTE_ID))
    expect(onPress).toHaveBeenCalledTimes(1)
  })
})
