import type { WindowPort } from '@session/app'
import type { Message } from '@session/client'

/**
 * How long arrivals have to stop before the conversation is marked read. A burst of messages is
 * one call rather than one per message, since each call writes the database and syncs the read
 * state to the account's other devices.
 */
export const READ_SETTLE_MS = 300

/** What the marker reads off the open conversation. */
export interface ReadView {
  /** False until the first page is loaded: until then, an empty transcript means nothing. */
  ready: boolean
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
 */
export function readTarget(view: ReadView): number | undefined {
  if (!view.ready) return undefined
  if (view.unreadCount === 0 && !view.markedUnread) return undefined
  let newest: number | undefined
  for (const message of view.messages) {
    if (!message.outgoing && (newest === undefined || message.timestamp > newest))
      newest = message.timestamp
  }
  return newest
}

export interface ReadMarkerOptions {
  /** Marks the conversation read up to and including `upToMs`. */
  markRead: (upToMs: number) => Promise<void>
  /** Whether the app is in front, which is what decides that a message on screen has been seen. */
  focus: Pick<WindowPort, 'isFocused' | 'onFocusChange'>
  settleMs: number
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
 * would change its state happens - a message sent or received, which moves the newest message, or
 * the conversation being closed and opened again, which makes a new marker. A read from another
 * device or an explicit mark read clears `markedUnread` itself, which ends the hold too.
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
  /** Set while a mark-unread made with the conversation open holds: the newest message then. */
  let holding: { lastActivity: number | undefined } | undefined

  function due(): number | undefined {
    if (!focused || view === undefined || holding !== undefined) return undefined
    const target = readTarget(view)
    if (target === undefined || (marked !== undefined && target <= marked)) return undefined
    return target
  }

  function cancel(): void {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    waitingFor = undefined
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
    cancel()
    if (target === undefined) return
    waitingFor = target
    timer = setTimeout(send, options.settleMs)
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
      else if (previous !== undefined && !previous.markedUnread)
        holding = { lastActivity: next.lastActivity }
      else if (holding !== undefined && next.lastActivity !== holding.lastActivity) {
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
