import type { SessionClient } from '@session/client'
import { singular, subscribeLocale, tr } from '@session/localization'
import { requireOptionalNativeModule } from 'expo'

const SessionPush = requireOptionalNativeModule<{
  setStrings(strings: Record<string, string>): void
}>('SessionPush')

/** What `modules/session-push` builds a notification from, by its names (`PushStrings.kt`). */
function words(): Record<string, string> {
  return {
    appName: tr('appName'),
    channel: tr('notificationsMessage'),
    generic: singular('messageNewYouveGot'),
    request: tr('messageRequestsNew'),
    you: tr('you'),
    image: tr('image'),
    animated: tr('gif'),
    video: tr('video'),
    audio: tr('audio'),
    voice: tr('messageVoice'),
    file: tr('document'),
    attachments: tr('attachments'),
    markRead: tr('messageMarkRead'),
    reply: tr('reply'),
    replyFailed: tr('messageErrorDelivery'),
  }
}

/**
 * Keeps the native push handler's words in the person's language: it posts notifications while
 * the app is not running, where the catalogue is out of reach. The bridge gets the word a mention
 * of the person becomes, for the notifications it decides while the app runs.
 */
export function followNotificationWords(client: Pick<SessionClient, 'setNotificationYou'>): void {
  const save = () => {
    SessionPush?.setStrings(words())
    void client.setNotificationYou(tr('you'))
  }
  save()
  subscribeLocale(save)
}
