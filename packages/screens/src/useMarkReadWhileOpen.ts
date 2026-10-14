import { appLog, requirePorts } from '@session/app'
import type { ConversationId } from '@session/client'
import { useSessionActions } from '@session/state'
import { useEffect, useRef } from 'react'

import { createReadMarker, READ_SETTLE_MS, type ReadMarker, type ReadView } from './readMarker'

/**
 * Marks the conversation on screen read: when it opens, and as messages arrive while the app is
 * in front. See `createReadMarker` for when a call is made.
 */
export function useMarkReadWhileOpen(conversationId: ConversationId, view: ReadView): void {
  const actions = useSessionActions()
  const marker = useRef<ReadMarker | null>(null)

  useEffect(() => {
    const created = createReadMarker({
      markRead: (upToMs) => actions.markRead(conversationId, upToMs),
      focus: requirePorts().window,
      settleMs: READ_SETTLE_MS,
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

  const { ready, messages, unreadCount, markedUnread } = view
  // Lists the marker's own dependencies too, so a marker made again is given the view at once:
  // effects run in order, so this one runs after the one above that made it.
  useEffect(() => {
    marker.current?.update({ ready, messages, unreadCount, markedUnread })
  }, [actions, conversationId, ready, messages, unreadCount, markedUnread])
}
