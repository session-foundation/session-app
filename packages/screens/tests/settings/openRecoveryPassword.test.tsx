import { afterEach, describe, expect, it, vi } from 'vitest'

import { memoryPorts, resetPorts, setPorts } from '@session/app'
import type { RecoveryPassword, SessionActions } from '@session/state'
import type { Modals } from '@session/ui'

import { hideAndLeave, openRecoveryPassword } from '#src/settings/RecoveryPasswordPage'

const SECRET: RecoveryPassword = { words: ['one', 'two'], seedHex: '00'.repeat(16) }

/** What happened, in order, across the ports and the modal stack. */
function setUp() {
  const calls: string[] = []
  const base = memoryPorts()
  setPorts(
    memoryPorts({
      window: {
        ...base.window,
        preventScreenCapture: (prevented) => {
          calls.push(prevented ? 'capture off' : 'capture on')
          return Promise.resolve()
        },
      },
    }),
  )
  const modals = {
    push: vi.fn(() => calls.push('push')),
    present: vi.fn(() => 'alert'),
    dismiss: vi.fn(),
    secureHost: vi.fn(() => calls.push('secure host')),
  } as unknown as Modals
  let resolve: (secret: RecoveryPassword) => void = () => undefined
  const actions = {
    getRecoveryPassword: () =>
      new Promise<RecoveryPassword>((settle) => {
        resolve = settle
      }),
  } as unknown as SessionActions
  return { calls, modals, actions, load: (secret: RecoveryPassword) => resolve(secret) }
}

afterEach(() => {
  resetPorts()
})

describe('openRecoveryPassword', () => {
  it('blocks capture and redraws the host before the page is in it, and lets go after', async () => {
    const { calls, modals, actions, load } = setUp()
    openRecoveryPassword(modals, actions)
    load(SECRET)
    await vi.waitFor(() => expect(calls).toContain('capture on'))
    expect(calls).toEqual(['capture off', 'secure host', 'push', 'capture on'])
  })

  it('opens one page for two presses while the words load', async () => {
    const { modals, actions, load } = setUp()
    openRecoveryPassword(modals, actions)
    openRecoveryPassword(modals, actions)
    load(SECRET)
    await vi.waitFor(() => expect(modals.push).toHaveBeenCalled())
    expect(modals.push).toHaveBeenCalledTimes(1)
  })
})

describe('hideAndLeave', () => {
  function stack() {
    const calls: string[] = []
    const modals = {
      lock: vi.fn(() => calls.push('lock')),
      dismiss: vi.fn(() => calls.push('dismiss')),
      pop: vi.fn(() => calls.push('pop')),
    } as unknown as Modals
    return { calls, modals }
  }

  it('goes back to Settings once hidden', async () => {
    const { calls, modals } = stack()
    hideAndLeave(
      modals,
      'alert',
      () => Promise.resolve(),
      () => calls.push('failed'),
    )
    await vi.waitFor(() => expect(calls).toContain('pop'))
    expect(calls).toEqual(['lock', 'dismiss', 'pop'])
  })

  it('stays on the page and says so when hiding fails', async () => {
    const { calls, modals } = stack()
    hideAndLeave(
      modals,
      'alert',
      () => Promise.reject(new Error('not stored')),
      () => calls.push('failed'),
    )
    await vi.waitFor(() => expect(calls).toContain('failed'))
    expect(calls).toEqual(['lock', 'dismiss', 'failed'])
  })
})
