import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ConversationUiContext, type ConversationUi } from '#src/conversationUi'
import { useMessageMenuOpener } from '#src/useMessageMenuOpener'

function conversationUi(): ConversationUi {
  return {
    conversationId: 'c',
    requestAutoDownloadPrompt: vi.fn(),
    nameOf: (author) => author,
    openViewer: vi.fn(),
    openSheet: vi.fn(),
    openMenu: vi.fn(),
    reply: vi.fn(),
  }
}

function opener(ui: ConversationUi, messageId: number) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ConversationUiContext.Provider value={ui}>{children}</ConversationUiContext.Provider>
  )
  return renderHook(({ id }: { id: number }) => useMessageMenuOpener(id), {
    wrapper,
    initialProps: { id: messageId },
  })
}

describe("a message's menu opener", () => {
  it('stays the same function across the row’s re-renders, so memoised tiles inside hold', () => {
    const { result, rerender } = opener(conversationUi(), 7)
    const first = result.current
    rerender({ id: 7 })
    expect(result.current).toBe(first)
  })

  it('is a new function for another message', () => {
    const { result, rerender } = opener(conversationUi(), 7)
    const first = result.current
    rerender({ id: 8 })
    expect(result.current).not.toBe(first)
  })

  it('opens the menu of its own message at the anchor given', () => {
    const ui = conversationUi()
    const { result } = opener(ui, 7)
    const anchor = { kind: 'point', x: 1, y: 2 } as const
    result.current(anchor)
    expect(ui.openMenu).toHaveBeenCalledWith(7, anchor)
  })
})
