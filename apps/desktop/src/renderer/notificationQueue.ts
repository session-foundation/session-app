import type { NotificationTap } from '@session/app'
import type { IncomingNotification } from '@session/client'

import { newestNotification, notificationSummary, notificationTap } from './notificationText'

/**
 * How often the one notification is rebuilt at most. Legacy desktop found that closing and making
 * notifications faster than this left some on screen for good, and a read on another device can
 * take down many at once.
 */
export const REBUILD_EVERY_MS = 2_000

/**
 * How long after connecting nothing is shown, as legacy desktop holds back: what arrives meanwhile
 * is the catching up, shown then as one summary if the window still lacks focus.
 */
export const HOLD_AFTER_CONNECT_MS = 10_000

export interface NotificationSummary {
  title: string
  body: string
  /** The newest message's conversation, at that message, or the message requests for a request. */
  tap: NotificationTap | null
  silent: boolean
}

export interface NotificationQueueDeps {
  /** Replaces the notification shown, or takes it down for null. */
  show: (summary: NotificationSummary | null) => void
  nowMs: () => number
  /** Runs `run` after `ms`; returns the means to cancel it. */
  schedule: (run: () => void, ms: number) => () => void
}

export interface NotificationQueue {
  add: (notification: IncomingNotification, options: { audio: boolean }) => void
  /** Drops those the bridge says are read or deleted. */
  remove: (ids: readonly string[]) => void
  /** Forgets every one: the window has focus, and main has taken the notification down. */
  clear: () => void
  /** Holds what arrives until `ms` from now. */
  holdFor: (ms: number) => void
}

/**
 * Legacy desktop's notifications: one for everything not yet seen, rebuilt at most every
 * `REBUILD_EVERY_MS` as messages arrive or are read, and gone once the window has focus. The OS
 * groups notifications differently on each desktop, so one is what every user already knows.
 */
export function createNotificationQueue(deps: NotificationQueueDeps): NotificationQueue {
  let queued: { notification: IncomingNotification; audio: boolean }[] = []
  let heldUntilMs = 0
  let cancel: (() => void) | null = null
  let showing = false

  const rebuild = () => {
    cancel = null
    const heldMs = heldUntilMs - deps.nowMs()
    if (heldMs > 0) {
      cancel = deps.schedule(rebuild, heldMs)
      return
    }
    const notifications = queued.map((q) => q.notification)
    const newest = newestNotification(notifications)
    const latest = queued.find((q) => q.notification === newest)
    const summary = notificationSummary(notifications)
    if (latest === undefined || summary === null) {
      if (showing) deps.show(null)
      showing = false
      return
    }
    showing = true
    deps.show({ ...summary, tap: notificationTap(latest.notification), silent: !latest.audio })
  }
  // Two seconds from the first change of a run, not from the last: a steady stream still shows.
  const changed = () => {
    cancel ??= deps.schedule(rebuild, REBUILD_EVERY_MS)
  }

  return {
    add: (notification, { audio }) => {
      if (queued.some((q) => q.notification.id === notification.id)) return
      queued.push({ notification, audio })
      changed()
    },
    remove: (ids) => {
      const before = queued.length
      queued = queued.filter((q) => !ids.includes(q.notification.id))
      if (queued.length !== before) changed()
    },
    clear: () => {
      queued = []
      showing = false
      cancel?.()
      cancel = null
    },
    holdFor: (ms) => {
      heldUntilMs = Math.max(heldUntilMs, deps.nowMs() + ms)
    },
  }
}
