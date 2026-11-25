import type { ClientClosed } from '@session/client'
import { emptyCounts, Pseudonyms, sweep } from '@session/logging'
import { describe, expect, it, vi } from 'vitest'

import {
  CLOSE_INTERRUPT_MS,
  CLOSE_WAIT_MS,
  closeClientInBackground,
  type BackgroundCloseDeps,
} from '#src/backgroundClose'

const CLOSED: ClientClosed = {
  closed: true,
  waitedMs: 120,
  closeMs: 40,
  outboundBusy: false,
  interrupted: false,
  interruptedForReopen: false,
}

/** A promise and the means to settle it, for a close or reopen the test finishes by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function harness(initialState = 'active') {
  let listener: (state: string) => void = () => {}
  const log = vi.fn<BackgroundCloseDeps['log']>()
  const deps = {
    client: {
      closeClient: vi.fn<BackgroundCloseDeps['client']['closeClient']>(() =>
        Promise.resolve(CLOSED),
      ),
      reopenClient: vi.fn<BackgroundCloseDeps['client']['reopenClient']>(() => Promise.resolve()),
      setReceiving: vi.fn<BackgroundCloseDeps['client']['setReceiving']>(() => Promise.resolve()),
    },
    onAppStateChange: (l: (state: string) => void) => {
      listener = l
    },
    initialState,
    task: { begin: vi.fn(), end: vi.fn() },
    log,
    flushLog: vi.fn(() => Promise.resolve()),
  }
  const whileOpen = closeClientInBackground(deps)
  return { deps, log, whileOpen, to: (state: string) => listener(state) }
}

/** Lets every queued continuation run. */
const drain = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('closing the database in the background', () => {
  it('closes under the background task, writes the log out, then ends the task', async () => {
    const { deps, log, to } = harness()
    to('background')
    expect(deps.task.begin).toHaveBeenCalledTimes(1)
    await drain()

    expect(deps.client.closeClient).toHaveBeenCalledWith(CLOSE_WAIT_MS, CLOSE_INTERRUPT_MS)
    expect(log).toHaveBeenCalledWith('info', expect.stringContaining('closed after waiting 120 ms'))
    expect(deps.flushLog).toHaveBeenCalledTimes(1)
    expect(deps.task.end).toHaveBeenCalledTimes(1)
    expect(deps.flushLog.mock.invocationCallOrder[0]).toBeLessThan(
      deps.task.end.mock.invocationCallOrder[0] ?? 0,
    )
  })

  it('stops receiving as the app leaves the screen, before the close, and restarts it on return', async () => {
    const { deps, to } = harness()
    to('background')
    expect(deps.client.setReceiving).toHaveBeenCalledWith(false)
    expect(deps.client.setReceiving.mock.invocationCallOrder[0]).toBeLessThan(
      deps.client.closeClient.mock.invocationCallOrder[0] ?? Infinity,
    )
    await drain()
    to('active')
    await drain()
    expect(deps.client.reopenClient).toHaveBeenCalledTimes(1)
    expect(deps.client.setReceiving).toHaveBeenLastCalledWith(true)
    expect(deps.client.setReceiving.mock.invocationCallOrder.at(-1)).toBeGreaterThan(
      deps.client.reopenClient.mock.invocationCallOrder[0] ?? Infinity,
    )
  })

  it('logs what a close lost at error level', async () => {
    const { deps, log, to } = harness()
    deps.client.closeClient.mockResolvedValueOnce({
      ...CLOSED,
      outboundBusy: true,
      interrupted: true,
    })
    to('background')
    await drain()
    expect(log).toHaveBeenCalledWith('error', expect.stringContaining('show as interrupted'))
    expect(log).toHaveBeenCalledWith('error', expect.stringContaining('rolled back'))
  })

  it('logs SQL still running when the app came back as critical', async () => {
    const { deps, log, to } = harness()
    deps.client.closeClient.mockResolvedValueOnce({
      ...CLOSED,
      interrupted: true,
      interruptedForReopen: true,
    })
    to('background')
    await drain()
    expect(log).toHaveBeenCalledWith('critical', expect.stringContaining('when the app came back'))
  })

  it('writes every outcome as it is, rather than as a redacted run of words', async () => {
    const outcomes: ClientClosed[] = [
      CLOSED,
      { ...CLOSED, closed: false },
      { ...CLOSED, outboundBusy: true, interrupted: true },
      { ...CLOSED, outboundBusy: true, interrupted: true, interruptedForReopen: true },
    ]
    for (const outcome of outcomes) {
      const { deps, log, to } = harness()
      deps.client.closeClient.mockResolvedValueOnce(outcome)
      to('background')
      await drain()
      const message = log.mock.calls[0]?.[1] ?? ''
      expect(sweep(message, new Pseudonyms(new Uint8Array(16)), emptyCounts())).toBe(message)
    }
  })

  it('reopens on return without waiting for a close that is still waiting', async () => {
    const { deps, to } = harness()
    const close = deferred<ClientClosed>()
    deps.client.closeClient.mockReturnValueOnce(close.promise)
    to('background')
    await drain()

    to('active')
    // Sent while the close is outstanding: it is what cancels the close.
    expect(deps.client.reopenClient).toHaveBeenCalledTimes(1)
    expect(deps.task.end).not.toHaveBeenCalled()

    close.resolve({ ...CLOSED, closed: false })
    await drain()
    expect(deps.task.end).toHaveBeenCalledTimes(1)
  })

  it('neither closes nor reopens for a return before the close began', async () => {
    const { deps, to } = harness()
    to('background')
    to('active')
    await drain()
    expect(deps.client.closeClient).not.toHaveBeenCalled()
    expect(deps.client.reopenClient).not.toHaveBeenCalled()
    expect(deps.task.end).toHaveBeenCalledTimes(1)
  })

  it('starts the next close only once the last close and the reopen have settled', async () => {
    const { deps, to } = harness()
    const first = deferred<ClientClosed>()
    const reopen = deferred<undefined>()
    deps.client.closeClient.mockReturnValueOnce(first.promise)
    deps.client.reopenClient.mockReturnValueOnce(reopen.promise)

    to('background')
    await drain()
    to('active')
    to('background')
    await drain()
    // Still one: the first close and the reopen are both outstanding.
    expect(deps.client.closeClient).toHaveBeenCalledTimes(1)

    first.resolve(CLOSED)
    await drain()
    expect(deps.client.closeClient).toHaveBeenCalledTimes(1)
    reopen.resolve(undefined)
    await drain()
    expect(deps.client.closeClient).toHaveBeenCalledTimes(2)

    // One grace across both: the first close finishing did not end the second's.
    expect(deps.task.begin).toHaveBeenCalledTimes(1)
    expect(deps.task.end).toHaveBeenCalledTimes(1)
  })

  it('ignores the states between and a repeated background', async () => {
    const { deps, to } = harness()
    to('inactive')
    to('background')
    to('background')
    await drain()
    expect(deps.client.closeClient).toHaveBeenCalledTimes(1)
    expect(deps.task.begin).toHaveBeenCalledTimes(1)
  })

  it('logs a close the bridge refused, and still ends the task', async () => {
    const { deps, log, to } = harness()
    deps.client.closeClient.mockRejectedValueOnce(new Error('closeClient: refused'))
    to('background')
    await drain()
    expect(log).toHaveBeenCalledWith('error', 'close failed: closeClient: refused')
    expect(deps.task.end).toHaveBeenCalledTimes(1)
  })

  describe('work in the background, such as a notification action', () => {
    it('opens the closed database for the work, then closes it again under the task', async () => {
      const { deps, whileOpen, to } = harness()
      to('background')
      await drain()
      expect(deps.task.end).toHaveBeenCalledTimes(1)

      const run = vi.fn(() => {
        expect(deps.client.reopenClient).toHaveBeenCalledTimes(1)
        return Promise.resolve('sent')
      })
      await expect(whileOpen(run)).resolves.toBe('sent')
      await drain()

      expect(run).toHaveBeenCalledTimes(1)
      expect(deps.client.closeClient).toHaveBeenCalledTimes(2)
      expect(deps.client.closeClient.mock.invocationCallOrder[1]).toBeGreaterThan(
        run.mock.invocationCallOrder[0] ?? Infinity,
      )
      // Receiving stays stopped: the app is still off the screen.
      expect(deps.client.setReceiving).not.toHaveBeenCalledWith(true)
      expect(deps.task.begin).toHaveBeenCalledTimes(2)
      expect(deps.task.end).toHaveBeenCalledTimes(2)
    })

    it('cancels a close still waiting, and closes once the work is over', async () => {
      const { deps, whileOpen, to } = harness()
      const close = deferred<ClientClosed>()
      deps.client.closeClient.mockReturnValueOnce(close.promise)
      to('background')
      await drain()

      const work = whileOpen(() => Promise.resolve())
      expect(deps.client.reopenClient).toHaveBeenCalledTimes(1)
      close.resolve({ ...CLOSED, closed: false })
      await work
      await drain()
      expect(deps.client.closeClient).toHaveBeenCalledTimes(2)
      expect(deps.task.end).toHaveBeenCalledTimes(1)
    })

    it('holds back a close the app leaves for until the work is over', async () => {
      const { deps, whileOpen, to } = harness()
      const done = deferred<undefined>()
      const work = whileOpen(() => done.promise)
      to('background')
      await drain()
      expect(deps.client.closeClient).not.toHaveBeenCalled()

      done.resolve(undefined)
      await work
      await drain()
      expect(deps.client.closeClient).toHaveBeenCalledTimes(1)
      expect(deps.task.end).toHaveBeenCalledTimes(1)
    })

    it('neither reopens nor closes for work while the app is on the screen', async () => {
      const { deps, whileOpen } = harness()
      await whileOpen(() => Promise.resolve())
      await drain()
      expect(deps.client.reopenClient).not.toHaveBeenCalled()
      expect(deps.client.closeClient).not.toHaveBeenCalled()
    })

    it('closes after work the app was launched in the background for', async () => {
      const { deps, whileOpen, to } = harness('background')
      await whileOpen(() => Promise.resolve())
      await drain()
      expect(deps.client.reopenClient).not.toHaveBeenCalled()
      expect(deps.client.closeClient).toHaveBeenCalledTimes(1)

      to('active')
      await drain()
      expect(deps.client.reopenClient).toHaveBeenCalledTimes(1)
      expect(deps.client.setReceiving).toHaveBeenLastCalledWith(true)
    })

    it('runs the work even when the reopen failed, and logs it', async () => {
      const { deps, log, whileOpen, to } = harness()
      to('background')
      await drain()
      deps.client.reopenClient.mockRejectedValueOnce(new Error('reopenClient: refused'))
      const run = vi.fn(() => Promise.resolve(false))
      await expect(whileOpen(run)).resolves.toBe(false)
      expect(log).toHaveBeenCalledWith('error', 'reopen for work failed: reopenClient: refused')
    })
  })
})
