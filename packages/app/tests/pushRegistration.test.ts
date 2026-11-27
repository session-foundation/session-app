import { emptyState, type SessionState } from '@session/state'
import { describe, expect, it, vi } from 'vitest'

import type { PushInstallMarker, PushTokenSource } from '#src/ports'
import { followPushRegistration } from '#src/pushRegistration'

/** A store holding just enough state, whose changes are made by the test. */
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

function harness(
  initial: Partial<SessionState>,
  token = 'token-1',
  marker: PushInstallMarker | null = null,
) {
  const store = stateStore(initial)
  let changed: () => void = () => {}
  const tokenOf = vi.fn(() => Promise.resolve({ service: 'firebase' as const, token }))
  const source: PushTokenSource = {
    token: tokenOf,
    onChange: (listener) => {
      changed = listener
      return () => {}
    },
  }
  const client = {
    setPushToken: vi.fn(() => Promise.resolve(true)),
    clearPushToken: vi.fn(() => Promise.resolve()),
  }
  const log = vi.fn()
  let active: () => void = () => {}
  const onActive = (listener: () => void) => {
    active = listener
    return () => {}
  }
  followPushRegistration({ store, client, source, marker, onActive, log })
  return { store, tokenOf, client, log, tokenChanged: () => changed(), comeToFront: () => active() }
}

/** Lets every queued continuation run. */
const drain = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('keeping the push subscription in step with the notification mode', () => {
  it('subscribes with Instant once there is an account and a network', async () => {
    const { store, client } = harness({ account: ACCOUNT, deliveryMode: 'instant' })
    await drain()
    expect(client.setPushToken).not.toHaveBeenCalled()

    store.set({ networkStatus: 'connected' })
    await drain()
    expect(client.setPushToken).toHaveBeenCalledWith('firebase', 'token-1', false)
  })

  it('does nothing before onboarding has chosen a mode, or without an account', async () => {
    const { store, client } = harness({ networkStatus: 'connected' })
    store.set({ account: ACCOUNT })
    await drain()
    expect(client.setPushToken).not.toHaveBeenCalled()
    expect(client.clearPushToken).not.toHaveBeenCalled()
  })

  it('removes the subscription when a mode without push is chosen, once', async () => {
    const { store, client } = harness({
      account: ACCOUNT,
      deliveryMode: 'instant',
      networkStatus: 'connected',
    })
    await drain()
    store.set({ deliveryMode: 'periodic' })
    await drain()
    store.set({ networkStatus: 'connecting' })
    store.set({ networkStatus: 'connected' })
    await drain()
    expect(client.clearPushToken).toHaveBeenCalledTimes(1)
  })

  it('removes it for every mode without push, as well as Periodic', async () => {
    for (const mode of ['always-connected', 'while-open'] as const) {
      const { client } = harness({
        account: ACCOUNT,
        deliveryMode: mode,
        networkStatus: 'connected',
      })
      await drain()
      expect(client.clearPushToken, mode).toHaveBeenCalledTimes(1)
      expect(client.setPushToken, mode).not.toHaveBeenCalled()
    }
  })

  it('sends again when the service issues a new token', async () => {
    const { client, tokenChanged } = harness({
      account: ACCOUNT,
      deliveryMode: 'instant',
      networkStatus: 'connected',
    })
    await drain()
    tokenChanged()
    await drain()
    expect(client.setPushToken).toHaveBeenCalledTimes(2)
  })

  it('tries again when the network comes back after a refusal', async () => {
    const { store, client, log } = harness({
      account: ACCOUNT,
      deliveryMode: 'instant',
      networkStatus: 'connected',
    })
    client.setPushToken.mockRejectedValueOnce(new Error('no network or no account'))
    await drain()
    expect(log).toHaveBeenCalledWith('warn', 'push registration failed: no network or no account')

    store.set({ networkStatus: 'disconnected' })
    store.set({ networkStatus: 'connected' })
    await drain()
    expect(client.setPushToken).toHaveBeenCalledTimes(2)
  })

  it('hands libsession the token again on coming to the front, to renew it', async () => {
    const { client, comeToFront } = harness({
      account: ACCOUNT,
      deliveryMode: 'instant',
      networkStatus: 'connected',
    })
    await drain()
    comeToFront()
    await drain()
    expect(client.setPushToken).toHaveBeenCalledTimes(2)
  })

  it('ignores changes that decide nothing, such as a new message', async () => {
    const { store, tokenOf } = harness({
      account: ACCOUNT,
      deliveryMode: 'instant',
      networkStatus: 'connected',
    })
    await drain()
    store.set({ attachmentUploadLimitBytes: 10 })
    store.set({ attachmentUploadLimitBytes: 11 })
    await drain()
    expect(tokenOf).toHaveBeenCalledTimes(1)
  })

  describe('the first subscription of an install', () => {
    /** A marker in memory, as an install's preferences would hold it. */
    function installMarker(subscribed: boolean) {
      let set = subscribed
      return {
        subscribed: () => set,
        markSubscribed: vi.fn(() => {
          set = true
        }),
      }
    }
    const READY = {
      account: ACCOUNT,
      deliveryMode: 'instant',
      networkStatus: 'connected',
    } as const

    it('is forced, and only that once', async () => {
      const marker = installMarker(false)
      const { client, tokenChanged } = harness(READY, 'token-1', marker)
      await drain()
      expect(client.setPushToken).toHaveBeenLastCalledWith('firebase', 'token-1', true)
      expect(marker.markSubscribed).toHaveBeenCalledTimes(1)

      tokenChanged()
      await drain()
      expect(client.setPushToken).toHaveBeenLastCalledWith('firebase', 'token-1', false)
    })

    it('is forced again after a refusal, until one is accepted', async () => {
      const marker = installMarker(false)
      const { store, client } = harness(READY, 'token-1', marker)
      client.setPushToken.mockRejectedValueOnce(new Error('no network or no account'))
      await drain()
      expect(marker.markSubscribed).not.toHaveBeenCalled()

      store.set({ networkStatus: 'disconnected' })
      store.set({ networkStatus: 'connected' })
      await drain()
      expect(client.setPushToken).toHaveBeenLastCalledWith('firebase', 'token-1', true)
      expect(marker.markSubscribed).toHaveBeenCalledTimes(1)
    })

    it('is not forced once an earlier launch of this install has subscribed', async () => {
      const { client } = harness(READY, 'token-1', installMarker(true))
      await drain()
      expect(client.setPushToken).toHaveBeenCalledWith('firebase', 'token-1', false)
    })
  })
})
