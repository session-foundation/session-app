import type { WordSource } from '@session/localization'

/**
 * The words only the phones' native push handlers use, beside the ones every notification is made
 * of (`NOTIFICATION_WORD_SOURCES`): the channels' names and the notification actions.
 *
 * The app hands both over in its own language at every launch (`followNotificationWords`), and
 * `scripts/generatePushWords.ts` writes every language's into the native code, for a push that
 * arrives before the app has ever run.
 */
export const PUSH_ONLY_WORDS = {
  channel: { text: 'notificationsMessage' },
  requestsChannel: { text: 'sessionMessageRequests' },
  markRead: { text: 'messageMarkRead' },
  reply: { text: 'reply' },
  send: { text: 'send' },
  replyFailed: { text: 'messageErrorDelivery' },
} as const satisfies Record<string, WordSource>
