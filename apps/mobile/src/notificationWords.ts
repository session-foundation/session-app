import type { SessionClient } from '@session/client'
import { notificationWords, subscribeLocale, tr, word } from '@session/localization'
import { requireOptionalNativeModule } from 'expo'

import { PUSH_ONLY_WORDS } from './pushWords'

const SessionPush = requireOptionalNativeModule<{
  setStrings(strings: Record<string, string>): void
}>('SessionPush')

/**
 * What `modules/session-push` builds a notification from, by its names (`PushStrings.kt`,
 * `AppGroup.swift`): every notification's words, and the phones' own.
 */
function words(): Record<string, string> {
  return {
    ...notificationWords(),
    ...Object.fromEntries(
      Object.entries(PUSH_ONLY_WORDS).map(([name, from]) => [name, word(from)]),
    ),
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
