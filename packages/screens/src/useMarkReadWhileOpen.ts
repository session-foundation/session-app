import { appLog, requirePorts } from '@session/app'
import type { ConversationId, Message } from '@session/client'
import { useSessionActions } from '@session/state'
import { useCallback, useEffect, useRef } from 'react'

import {
  createReadMarker,
  READ_MAX_WAIT_MS,
  READ_SETTLE_MS,
  type ReadMarker,
  type ReadView,
} from './readMarker'

/** The open conversation, with every message loaded rather than only those seen. */
export interface LoadedReadView extends Omit<ReadView, 'messages'> {
  loaded: readonly Message[]
  /** The key the transcript reports a message's row by. */
  keyOf: (message: Message) => string
}

/**
 * Marks the conversation on screen read, up to the newest message seen: when it opens, as messages
 * come into view, and as they arrive while the app is in front. See `createReadMarker` for when a
 * call is made.
 *
 * Returns what the transcript reports its seen rows to. They go to the marker without passing
 * through React state, so scrolling re-renders nothing.
 */
export function useMarkReadWhileOpen(
  conversationId: ConversationId,
  view: LoadedReadView,
): (keys: readonly string[]) => void {
  const actions = useSessionActions()
  const marker = useRef<ReadMarker | null>(null)
  const latest = useRef(view)
  const seenKeys = useRef<ReadonlySet<string>>(new Set())

  const tell = useCallback(() => {
    const { loaded, keyOf, ...rest } = latest.current
    const keys = seenKeys.current
    marker.current?.update({ ...rest, messages: loaded.filter((m) => keys.has(keyOf(m))) })
  }, [])

  useEffect(() => {
    const created = createReadMarker({
      markRead: (upToMs) => actions.markRead(conversationId, upToMs),
      focus: requirePorts().window,
      settleMs: READ_SETTLE_MS,
      maxWaitMs: READ_MAX_WAIT_MS,
      onError: (error) => {
        appLog.warn('session', 'could not mark a conversation read', {
          error: error instanceof Error ? error.message : String(error),
        })
      },
    })
    marker.current = created
    return () => {
      created.dispose()
      if (marker.current === created) marker.current = null
    }
  }, [actions, conversationId])

  const { ready, covered, loaded, keyOf, lastActivity, unreadCount, markedUnread } = view
  // Lists the marker's own dependencies too, so a marker made again is given the view at once:
  // effects run in order, so this one runs after the one above that made it.
  useEffect(() => {
    latest.current = { ready, covered, loaded, keyOf, lastActivity, unreadCount, markedUnread }
    tell()
  }, [
    actions,
    conversationId,
    tell,
    ready,
    covered,
    loaded,
    keyOf,
    lastActivity,
    unreadCount,
    markedUnread,
  ])

  return useCallback(
    (keys: readonly string[]) => {
      seenKeys.current = new Set(keys)
      tell()
    },
    [tell],
  )
}
