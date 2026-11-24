import type { IncomingNotification, SessionClient } from '@session/client'
import type { SessionState } from '@session/state'

import type { NotificationsPort } from './ports'

export interface NotificationDeps {
  client: Pick<SessionClient, 'onEvent'>
  store: { getState(): SessionState }
  notifications: Pick<NotificationsPort, 'post' | 'remove' | 'setBadgeCount'>
  /**
   * Whether to post one now, beyond what libsession decided: false for the conversation on screen
   * while the app is in front, and on desktop while its window has focus, as legacy desktop does.
   */
  shouldPost: (notification: IncomingNotification) => boolean
}

/**
 * Posts what the bridge says to notify about for messages that arrive while the app runs, takes
 * down what it says is stale, and keeps the app icon's count. libsession has already applied mutes,
 * blocks, requests and the content setting; desktop's own switch for showing notifications at all
 * is applied here, since it is a setting of this app rather than of libsession.
 */
export function followNotifications(deps: NotificationDeps): () => void {
  const { client, store, notifications, shouldPost } = deps
  return client.onEvent((event) => {
    switch (event.type) {
      case 'notification': {
        const state = store.getState()
        if (state.notificationsShown === false || !shouldPost(event.notification)) return
        notifications.post?.(event.notification, { audio: state.audioNotifications ?? false })
        return
      }
      case 'notifications-stale':
        notifications.remove?.(event.ids)
        return
      case 'badge':
        void notifications.setBadgeCount(event.count)
        return
      default:
        return
    }
  })
}
