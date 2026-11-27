import type { ClientClosed, SessionClient } from '@session/client'

/**
 * How long a close waits for outbound work to end before it lets the Client go anyway. A send
 * still going then shows as interrupted, and is retried by hand.
 */
export const CLOSE_WAIT_MS = 10_000

/**
 * When the database's SQL is interrupted if destroying the Client is still not done, counted from
 * the app leaving the screen. iOS gives about 26 s from there (measured on an iPhone X); this
 * leaves the rest for the rollback and the log, and for the notification extension, which waits
 * for the app to let go of the database before it can open it.
 */
export const CLOSE_INTERRUPT_MS = 15_000

export interface BackgroundCloseDeps {
  client: Pick<SessionClient, 'closeClient' | 'reopenClient' | 'setReceiving'>
  /** Calls back with each change of the app's state: `background`, `active`, and the others. */
  onAppStateChange: (listener: (state: string) => void) => void
  /**
   * The app's state at the start: `background` when iOS launched it to carry out a notification's
   * action, which closes the database again once the action is over.
   */
  initialState: string
  /**
   * After a reopen, whether it built the Client again or cancelled a close still waiting: whatever
   * a rebuilt Client missed is read again, which costs a read when nothing was missed.
   */
  onReopened: () => void
  /** The OS's grace to finish in once the app has left the screen, as `backgroundTask` keeps it. */
  task: { begin: () => void; end: () => void }
  log: (level: 'info' | 'warn' | 'error' | 'critical', message: string) => void
  /** Writes the log out: the process is suspended the moment the task ends. */
  flushLog: () => Promise<void>
}

/**
 * The close's outcome as one log line: error level where something was lost, critical where SQL was
 * still running when the app came back. Nothing in libsession should run that long, so that one is
 * a bug to find, and the app has rolled it back to be usable again.
 *
 * **No thirteen words in a row**: the log writer redacts that as the shape of a recovery phrase, so
 * a long sentence reaches the file as `<13 words>`. A number or a colon breaks the run.
 */
function report(result: ClientClosed): { level: 'info' | 'error' | 'critical'; message: string } {
  if (!result.closed)
    return { level: 'info', message: `close cancelled after ${String(result.waitedMs)} ms` }
  const timing =
    `closed after waiting ${String(result.waitedMs)} ms for outbound work, ` +
    `in ${String(result.closeMs)} ms`
  const lost = [
    ...(result.outboundBusy ? ['a send still in flight will show as interrupted'] : []),
    ...(result.interruptedForReopen
      ? [
          `SQL was still running ${String(result.closeMs)} ms into the close when the app ` +
            'came back: interrupted and rolled back',
        ]
      : result.interrupted
        ? ['the database was interrupted and its statement rolled back']
        : []),
  ]
  if (lost.length === 0) return { level: 'info', message: timing }
  return {
    level: result.interruptedForReopen ? 'critical' : 'error',
    message: `${timing}: ${lost.join('; ')}`,
  }
}

/**
 * Runs some work with the database open: iOS can wake an app whose database is closed to carry out
 * a notification's action.
 */
export type WhileOpen = <T>(run: () => Promise<T>) => Promise<T>

/** What `closeClientInBackground` gives the work that needs the database open. */
export interface OpenHolds {
  /** Work in the background, a notification's action: closes the database again after. */
  whileOpen: WhileOpen
  /**
   * Work that brings the app to the front, a notification's tap: run once the app is there with
   * its database open, and never followed by a close of its own.
   */
  onceInFront: WhileOpen
}

/**
 * Closes the database when the app leaves the screen and opens it again when the app comes back.
 *
 * **iOS only** (`clientLifecycle.ios.ts`). The database is in the app group, so the notification
 * extension can open it, and iOS kills an app suspended while holding a lock on a file in a shared
 * container (0xdead10cc): any write in flight at that moment is enough. A closed database holds
 * none. Android has no such rule, and its push handling runs in the app's own process.
 *
 * **Receiving stops first**, the moment the app leaves the screen, so that what arrives meanwhile
 * is the notification extension's to receive and show; the close only finishes outbound work. It
 * restarts when the app comes back, whether the close was cancelled or the Client built again.
 *
 * One close at a time: one that a return to the app cancelled still has to settle before the next
 * begins, and the next is skipped if the app came back meanwhile.
 *
 * **Work in the background** goes through `whileOpen`: it opens the database again for the work,
 * under the background task, and closes it once the last such work is over if the app is still
 * off the screen. Receiving stays stopped meanwhile. A tap goes through `onceInFront` instead: iOS
 * hands the app a tap before it says the app is in front, and a close after the tap's work, the app
 * still seeming off the screen, closed the database under the screen the tap led to.
 */
export function closeClientInBackground(deps: BackgroundCloseDeps): OpenHolds {
  const { client, log } = deps
  let inBackground = deps.initialState === 'background'
  /** The close under way, or the last one, settled or not. */
  let closing: Promise<unknown> = Promise.resolve()
  /** The reopen under way, or the last one: a close after a quick return waits for it too. */
  let reopening: Promise<unknown> = Promise.resolve()
  let closeAsked = false
  /** Work running through `whileOpen`: no close starts until it is over. */
  let working = 0
  /** Work waiting for the app to come to the front: see `onceInFront`. */
  const waitingForFront: (() => void)[] = []

  // Counted, since a close the app came back from can still be settling as the next one begins,
  // and the first to finish must not end the grace the other is running in.
  let held = 0
  const hold = () => {
    if (held++ === 0) deps.task.begin()
  }
  const release = () => {
    if (--held === 0) deps.task.end()
  }

  const close = async (): Promise<void> => {
    if (!inBackground || working > 0 || closeAsked) return
    closeAsked = true
    try {
      const { level, message } = report(await client.closeClient(CLOSE_WAIT_MS, CLOSE_INTERRUPT_MS))
      log(level, message)
    } catch (error) {
      log('error', `close failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const startClose = () => {
    hold()
    closing = Promise.all([closing, reopening])
      .then(close)
      .finally(() => {
        void deps.flushLog().finally(release)
      })
  }

  /** Cancels a close still waiting for outbound work; otherwise builds the Client again. */
  const reopen = (): Promise<void> => {
    closeAsked = false
    const startedMs = Date.now()
    return client.reopenClient().then(() => {
      log('info', `reopened in ${String(Date.now() - startedMs)} ms`)
      deps.onReopened()
    })
  }

  deps.onAppStateChange((state) => {
    if (state === 'background' && !inBackground) {
      inBackground = true
      void client
        .setReceiving(false)
        .catch((error: unknown) =>
          log(
            'warn',
            `pausing receiving failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        )
      startClose()
    } else if (state === 'active' && inBackground) {
      inBackground = false
      const resume = () =>
        client
          .setReceiving(true)
          .catch((error: unknown) =>
            log(
              'warn',
              `resuming receiving failed: ${error instanceof Error ? error.message : String(error)}`,
            ),
          )
      if (!closeAsked) {
        // Not closed, or not yet: the close sees the app back and does nothing.
        reopening = resume()
      } else {
        // Not chained behind the close, which may still be waiting.
        reopening = reopen()
          .then(resume)
          .catch((error: unknown) =>
            log(
              'error',
              `reopen failed: ${error instanceof Error ? error.message : String(error)}`,
            ),
          )
      }
      for (const go of waitingForFront.splice(0)) go()
    }
  })

  const onceInFront: WhileOpen = (run) =>
    new Promise((resolve, reject) => {
      const go = () => {
        reopening.then(run).then(resolve, reject)
      }
      if (inBackground) waitingForFront.push(go)
      else go()
    })

  const whileOpen: WhileOpen = async (run) => {
    hold()
    working++
    try {
      if (closeAsked)
        reopening = reopen().catch((error: unknown) =>
          log(
            'error',
            `reopen for work failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        )
      await reopening
      return await run()
    } finally {
      working--
      if (inBackground && working === 0) startClose()
      release()
    }
  }

  return { whileOpen, onceInFront }
}
