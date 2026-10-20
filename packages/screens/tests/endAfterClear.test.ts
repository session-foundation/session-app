import { memoryPorts, resetPorts, setPorts } from '@session/app'
import { SessionClientError, type SessionClient } from '@session/client'
import { friends } from '@session/client/fake'
import { createSessionStore } from '@session/state'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { clearAfterStartupFailure } from '#src/endAfterClear'

function alice(): SessionClient {
  const client = friends(['Alice', 'Bob']).clients['Alice']
  if (!client) throw new Error('fixture did not produce a client')
  return client
}

function relaunching(): () => void {
  const restart = vi.fn()
  const ports = memoryPorts()
  setPorts({ ...ports, window: { ...ports.window, restart } })
  return restart
}

describe("the startup-failure screen's clear", () => {
  afterEach(() => {
    resetPorts()
  })

  it('relaunches after a failed Settings > Clear data, as that clear does once it succeeds', async () => {
    const restart = relaunching()
    const client = alice()
    const store = createSessionStore(client)
    await store.actions.start()

    const discard = client.discardAccount.bind(client)
    client.discardAccount = () => Promise.reject(new SessionClientError('disk full'))
    await expect(store.actions.clearDeviceData()).rejects.toThrow('disk full')
    expect(store.getState().startupError).toBe('disk full')

    // What the screen reads at render: media from this account may have been drawn already.
    const accountLoaded = store.getState().account?.haveAccount === true
    client.discardAccount = discard
    await clearAfterStartupFailure(() => store.actions.clearDeviceData(), accountLoaded)
    expect(restart).toHaveBeenCalledTimes(1)
  })

  it('starts again in place where the database never opened', async () => {
    const restart = relaunching()
    const client = alice()
    const store = createSessionStore(client)
    client.getAccountInfo = () => Promise.reject(new SessionClientError('file is not a database'))
    await store.actions.start()
    expect(store.getState().startupError).toBe('file is not a database')

    const accountLoaded = store.getState().account?.haveAccount === true
    await clearAfterStartupFailure(() => store.actions.clearDeviceData(), accountLoaded)
    expect(restart).not.toHaveBeenCalled()
  })

  it('does not end the process after a clear that failed', async () => {
    const restart = relaunching()
    const failed = clearAfterStartupFailure(() => Promise.reject(new Error('disk full')), true)
    await expect(failed).rejects.toThrow('disk full')
    expect(restart).not.toHaveBeenCalled()
  })
})
