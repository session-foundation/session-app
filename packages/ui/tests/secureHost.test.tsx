import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'

import { ModalStackProvider, useHostSecured, useModals } from '#src/ModalsProvider'

function wrapper({ children }: { children: ReactNode }) {
  return <ModalStackProvider>{children}</ModalStackProvider>
}

function useHost() {
  return { modals: useModals(), secured: useHostSecured() }
}

/**
 * The host redraws its native modal only when this changes, and a page inside that modal is
 * mounted again by the redraw and asks again: a second ask that changed it would loop.
 */
describe('secureHost', () => {
  it('turns on once, stays on while anything is open, and goes with the last modal', () => {
    const { result } = renderHook(useHost, { wrapper })
    act(() => {
      result.current.modals.present({ initial: { title: 'Settings', render: () => null } })
    })
    expect(result.current.secured).toBe(false)

    act(() => {
      result.current.modals.secureHost()
    })
    expect(result.current.secured).toBe(true)
    act(() => {
      result.current.modals.secureHost()
    })
    expect(result.current.secured).toBe(true)

    act(() => {
      result.current.modals.dismissAll()
    })
    expect(result.current.secured).toBe(false)
  })
})
