import type { NotificationTap } from '@session/app'
import type { IncomingNotification } from '@session/client'
import { notificationWords, tr } from '@session/localization'

/**
 * What a notification says, as the phones' push handlers write it: the sender and the message; the
 * sender and "You've got a new message." when the content setting hides the message; Session and
 * that line when it hides both; Session and "You have a new message request" for a request.
 */
function notificationText(notification: IncomingNotification): {
  title: string
  body: string
} {
  // The phones' push handlers build theirs from the same words.
  const words = notificationWords()
  if (notification.kind === 'request') return { title: words.appName, body: words.request }
  const title = notification.sender ?? words.appName
  if (notification.body !== undefined) return { title, body: notification.body }
  if (notification.attachments > 1) return { title, body: words.attachments }
  if (notification.attachment !== undefined) return { title, body: words[notification.attachment] }
  return { title, body: words.generic }
}

/** Where clicking it leads. */
export function notificationTap(notification: IncomingNotification): NotificationTap | null {
  if (notification.kind === 'request') return { kind: 'requests' }
  return notification.conversationId === undefined
    ? null
    : {
        kind: 'conversation',
        conversationId: notification.conversationId,
        messageId: notification.messageId,
      }
}

/**
 * The newest of them by when it was sent: a batch can come in any order. The later of two sent in
 * the same millisecond is the one that came in later.
 */
export function newestNotification<T extends Pick<IncomingNotification, 'timestamp'>>(
  notifications: readonly T[],
): T | undefined {
  return notifications.reduce<T | undefined>(
    (newest, n) => (newest === undefined || n.timestamp >= newest.timestamp ? n : newest),
    undefined,
  )
}

/**
 * The one notification legacy desktop keeps for every message not yet seen, by the newest of them:
 * the sender and the message for one, and "New Messages" with "Most recent from" the sender for
 * more, as the content setting allows. libsession has applied that setting already, so what the
 * newest carries says which it is: no sender means "New Messages" alone, as for a request.
 */
export function notificationSummary(
  notifications: readonly IncomingNotification[],
): { title: string; body: string } | null {
  const latest = newestNotification(notifications)
  if (latest === undefined) return null
  const count = notifications.length
  const newMessages = tr('messageNew', { count })
  if (latest.kind === 'request')
    return { title: tr('appName'), body: count === 1 ? tr('messageRequestsNew') : newMessages }
  const name = latest.sender
  if (name === undefined) return { title: tr('appName'), body: newMessages }
  const mostRecent = tr('notificationsMostRecent', { name })
  const withContent = latest.body !== undefined || latest.attachments > 0
  if (!withContent)
    return { title: newMessages, body: count === 1 ? `${tr('from')} ${name}` : mostRecent }
  const { body } = notificationText(latest)
  return count === 1
    ? { title: name, body }
    : { title: newMessages, body: `${mostRecent}: ${body}` }
}
