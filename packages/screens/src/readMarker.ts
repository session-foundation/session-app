import type { WindowPort } from '@session/app'
import type { Message } from '@session/client'

/**
 * How long arrivals have to stop before the conversation is marked read. A burst of messages is
 * one call rather than one per message, since each call writes the database and syncs the read
 * state to the account's other devices.
 */
export const READ_SETTLE_MS = 300

/**
 * The longest a mark waits for arrivals to stop. Without it, messages arriving faster than the
 * settle would put the mark off until they stopped or the conversation closed.
 */
export const READ_MAX_WAIT_MS = 2000

/**
 * A mark that clears `markedUnread` without moving the read point: libsession clears the flag on
 * any mark given a timestamp, and moves the read point only forwards.
 */
export const CLEAR_FLAG_ONLY = 0

/** What the marker reads off the open conversation. */
export interface ReadView {
  /**
   * False until the first page and the conversation's own row are loaded: until then, an empty
   * transcript or an unset `markedUnread` means nothing.
   */
  ready: boolean
  /**
   * Something is drawn over the transcript, such as the media viewer, a menu or the modal stack:
   * the rows beneath it are on screen as far as the list knows, and not being read.
   */
  covered: boolean
  /** The messages seen: those whose bottom edge is on screen. */
  messages: readonly Message[]
  /**
   * The conversation's last activity, which moves when a message is sent or received there: not
   * the newest message in the window, which a page or a jump changes too.
   */
  lastActivity: number | undefined
  unreadCount: number
  markedUnread: boolean
}

/**
 * The timestamp to mark read up to, or undefined when there is nothing to mark.
 *
 * The newest *incoming* message seen, not the newest of all: libsession's watermark counts
 * incoming messages by their sender's clock, so an outgoing timestamp from this device's clock
 * could pass over a message that was sent earlier and has not arrived yet, and mark it read
 * unseen.
 *
 * A conversation marked unread with nothing unread in it, and no incoming message on screen, such
 * as Note to Self, is cleared with `CLEAR_FLAG_ONLY`: there is no incoming message to name.
 */
export function readTarget(view: ReadView): number | undefined {
  if (!view.ready) return undefined
  if (view.unreadCount === 0 && !view.markedUnread) return undefined
  let newest: number | undefined
  for (const message of view.messages) {
    if (!message.outgoing && (newest === undefined || message.timestamp > newest))
      newest = message.timestamp
  }
  if (newest === undefined && view.markedUnread && view.unreadCount === 0) return CLEAR_FLAG_ONLY
  return newest
}

export interface ReadMarkerOptions {
  /** Marks the conversation read up to and including `upToMs`. */
  markRead: (upToMs: number) => Promise<void>
  /** Whether the app is in front, which is what decides that a message on screen has been seen. */
  focus: Pick<WindowPort, 'isFocused' | 'onFocusChange'>
  settleMs: number
  /** The longest a mark waits for arrivals to stop; see `READ_MAX_WAIT_MS`. */
  maxWaitMs: number
  onError?: ((error: unknown) => void) | undefined
}

export interface ReadMarker {
  /** The conversation as it is now. Calling this with an unchanged view does nothing. */
  update: (view: ReadView) => void
  /** Stops listening, and makes any mark still waiting out its delay while the app is in front. */
  dispose: () => void
}

/**
 * Keeps an open conversation read while the app is in front.
 *
 * Marking it unread while it is open holds: nothing is marked read again until something that
 * would change its state happens - a message sent or received, which moves its last activity or
 * raises its unread count, or the conversation being closed and opened again, which makes a new
 * marker. A read from another device or an explicit mark read clears `markedUnread` itself, which
 * ends the hold too.
 *
 * A mark that fails is asked for again on the next change, not on a timer.
 *
 * Plain rather than a hook so it can be driven by a store and a clock in a test: this package has
 * no renderer to mount a screen with.
 *
 * Asks for each timestamp at most once. Otherwise a conversation whose unread messages are not
 * shown yet would call again on every change until they were.
 */
export function createReadMarker(options: ReadMarkerOptions): ReadMarker {
  let view: ReadView | undefined
  let focused = options.focus.isFocused()
  /** The highest timestamp asked for so far. */
  let marked: number | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let waitingFor: number | undefined
  /** When the mark now waiting first began to wait, for `maxWaitMs`. */
  let waitingSince: number | undefined
  /** Set while a mark-unread made with the conversation open holds: its state then. */
  let holding: { lastActivity: number | undefined; unreadCount: number } | undefined

  function due(): number | undefined {
    if (!focused || view === undefined || view.covered || holding !== undefined) return undefined
    const target = readTarget(view)
    if (target === undefined || (marked !== undefined && target <= marked)) return undefined
    return target
  }

  function cancel(): void {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    waitingFor = undefined
    waitingSince = undefined
  }

  function send(): void {
    cancel()
    const target = due()
    if (target === undefined) return
    marked = target
    options.markRead(target).catch((error: unknown) => {
      // Forgotten so the next change asks again, rather than this timestamp never being retried.
      if (marked === target) marked = undefined
      options.onError?.(error)
    })
  }

  function schedule(): void {
    const target = due()
    // Restarted only by a new target: a change that moves nothing, such as an outgoing message
    // being sent, must not keep pushing the mark back.
    if (target === waitingFor) return
    if (target === undefined) {
      cancel()
      return
    }
    if (timer !== undefined) clearTimeout(timer)
    const now = Date.now()
    waitingSince ??= now
    waitingFor = target
    const left = waitingSince + options.maxWaitMs - now
    timer = setTimeout(send, Math.max(0, Math.min(options.settleMs, left)))
  }

  const stopListening = options.focus.onFocusChange((now) => {
    focused = now
    schedule()
  })

  return {
    update(next) {
      const previous = view
      view = next
      if (!next.markedUnread) holding = undefined
      // Only from a known state: a row not loaded yet reads as not marked, and one that turns out
      // to be marked when it loads is cleared, as on opening, rather than held.
      else if (previous?.ready === true && !previous.markedUnread)
        holding = { lastActivity: next.lastActivity, unreadCount: next.unreadCount }
      else if (
        holding !== undefined &&
        // A received message raises the count even when its sender's clock leaves the last
        // activity where it was.
        (next.lastActivity !== holding.lastActivity || next.unreadCount > holding.unreadCount)
      ) {
        holding = undefined
        // The flag is still set, so marking the same timestamp again is what clears it.
        marked = undefined
      }
      schedule()
    },
    dispose() {
      stopListening()
      if (timer !== undefined) send()
    },
  }
}
