import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'

import { RoutedConversationProvider, useIsRoutedOnTop } from '#src/shell/routedConversation'

function routed(id: string | undefined) {
  return ({ children }: { children: ReactNode }) => (
    <RoutedConversationProvider value={{ id }}>{children}</RoutedConversationProvider>
  )
}

describe('whether a conversation is the route on top', () => {
  it('is, when the router has it on top', () => {
    const { result } = renderHook(() => useIsRoutedOnTop('bob'), { wrapper: routed('bob') })
    expect(result.current).toBe(true)
  })

  it('is not, under another conversation pushed over it, as a tapped notification does', () => {
    const { result } = renderHook(() => useIsRoutedOnTop('bob'), { wrapper: routed('carol') })
    expect(result.current).toBe(false)
  })

  it('is not, under a route that is no conversation, such as Message Requests', () => {
    const { result } = renderHook(() => useIsRoutedOnTop('bob'), { wrapper: routed(undefined) })
    expect(result.current).toBe(false)
  })

  it('is, outside a shell, where nothing is routed over it', () => {
    const { result } = renderHook(() => useIsRoutedOnTop('bob'))
    expect(result.current).toBe(true)
  })
})
