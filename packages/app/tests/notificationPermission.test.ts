import { emptyState, type SessionState } from '@session/state'
import { describe, expect, it, vi } from 'vitest'

import { followNotificationPermission } from '#src/notificationPermission'

function stateStore(initial: Partial<SessionState>) {
  let state: SessionState = { ...emptyState, ...initial }
  const listeners = new Set<() => void>()
  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set: (next: Partial<SessionState>) => {
      state = { ...state, ...next }
      for (const listener of listeners) listener()
    },
  }
}

const ACCOUNT = { haveAccount: true, networkAttached: true } as SessionState['account']

function harness(initial: Partial<SessionState>) {
  const store = stateStore(initial)
  const requestPermission = vi.fn(() => Promise.resolve(true))
  followNotificationPermission({ store, requestPermission, log: vi.fn() })
  return { store, requestPermission }
}

describe('asking to show notifications', () => {
  it('asks once a delivery mode is chosen, whichever it is', () => {
    const { store, requestPermission } = harness({ account: ACCOUNT })
    expect(requestPermission).not.toHaveBeenCalled()
    store.set({ deliveryMode: 'periodic' })
    expect(requestPermission).toHaveBeenCalledTimes(1)
  })

  it('asks at startup for a mode chosen before', () => {
    const { requestPermission } = harness({ account: ACCOUNT, deliveryMode: 'while-open' })
    expect(requestPermission).toHaveBeenCalledTimes(1)
  })

  it('asks again only when the mode changes, not on every change to the store', () => {
    const { store, requestPermission } = harness({ account: ACCOUNT, deliveryMode: 'instant' })
    store.set({ attachmentUploadLimitBytes: 10 })
    expect(requestPermission).toHaveBeenCalledTimes(1)
    store.set({ deliveryMode: 'always-connected' })
    expect(requestPermission).toHaveBeenCalledTimes(2)
  })

  it('does not ask without an account', () => {
    const { requestPermission } = harness({ deliveryMode: 'instant' })
    expect(requestPermission).not.toHaveBeenCalled()
  })
})
