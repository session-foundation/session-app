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
  client: Pick<SessionClient, 'closeClient' | 'reopenClient'>
  /**
   * Calls back with the app's state as it is now, then with each change: `background`, `active`,
   * and the others. The first call matters: an app that left the screen before this was attached
   * sends no change until it comes back.
   */
  onAppStateChange: (listener: (state: string) => void) => void
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
 * Closes the database when the app leaves the screen and opens it again when the app comes back.
 *
 * **iOS only** (`clientLifecycle.ios.ts`). The database is in the app group, so the notification
 * extension can open it, and iOS kills an app suspended while holding a lock on a file in a shared
 * container (0xdead10cc): any write in flight at that moment is enough. A closed database holds
 * none. Android has no such rule, and its push handling runs in the app's own process.
 *
 * One close at a time: one that a return to the app cancelled still has to settle before the next
 * begins, and the next is skipped if the app came back meanwhile.
 */
export function closeClientInBackground(deps: BackgroundCloseDeps): void {
  const { client, log } = deps
  let inBackground = false
  /** The close under way, or the last one, settled or not. */
  let closing: Promise<unknown> = Promise.resolve()
  /** The reopen under way, or the last one: a close after a quick return waits for it too. */
  let reopening: Promise<unknown> = Promise.resolve()
  let closeAsked = false

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
    if (!inBackground) return
    closeAsked = true
    try {
      const { level, message } = report(await client.closeClient(CLOSE_WAIT_MS, CLOSE_INTERRUPT_MS))
      log(level, message)
    } catch (error) {
      log('error', `close failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  deps.onAppStateChange((state) => {
    if (state === 'background' && !inBackground) {
      inBackground = true
      hold()
      closing = Promise.all([closing, reopening])
        .then(close)
        .finally(() => {
          void deps.flushLog().finally(release)
        })
    } else if (state === 'active' && inBackground) {
      inBackground = false
      if (!closeAsked) return
      closeAsked = false
      // Cancels a close still waiting for outbound work; otherwise builds the Client again,
      // answering once it is back. Not chained behind the close, which may still be waiting.
      const startedMs = Date.now()
      reopening = client
        .reopenClient()
        .then(() => {
          log('info', `reopened in ${String(Date.now() - startedMs)} ms`)
          deps.onReopened()
        })
        .catch((error: unknown) =>
          log('error', `reopen failed: ${error instanceof Error ? error.message : String(error)}`),
        )
    }
  })
}
