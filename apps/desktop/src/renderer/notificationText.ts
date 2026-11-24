import type { NotificationTap } from '@session/app'
import type { IncomingNotification, NotificationAttachment } from '@session/client'
import { singular, tr } from '@session/localization'

const ATTACHMENT_WORDS: Record<NotificationAttachment, () => string> = {
  image: () => tr('image'),
  animated: () => tr('gif'),
  video: () => tr('video'),
  audio: () => tr('audio'),
  voice: () => tr('messageVoice'),
  file: () => tr('document'),
}

/**
 * What a notification says, as the phones' push handlers write it: the sender and the message; the
 * sender and "You've got a new message." when the content setting hides the message; Session and
 * that line when it hides both; Session and "You have a new message request" for a request.
 */
export function notificationText(notification: IncomingNotification): {
  title: string
  body: string
} {
  if (notification.kind === 'request')
    return { title: tr('appName'), body: tr('messageRequestsNew') }
  const title = notification.sender ?? tr('appName')
  if (notification.body !== undefined) return { title, body: notification.body }
  if (notification.attachments > 1) return { title, body: tr('attachments') }
  if (notification.attachment !== undefined)
    return { title, body: ATTACHMENT_WORDS[notification.attachment]() }
  return { title, body: singular('messageNewYouveGot') }
}

/** Where clicking it leads. */
export function notificationTap(notification: IncomingNotification): NotificationTap | null {
  if (notification.kind === 'request') return { kind: 'requests' }
  return notification.conversationId === undefined
    ? null
    : { kind: 'conversation', conversationId: notification.conversationId }
}
