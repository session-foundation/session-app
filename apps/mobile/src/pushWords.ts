import type { TokenPluralWithArgs, TokenSimpleNoArgs } from '@session/localization'

/**
 * The words the native push handlers build a notification from: the name native code reads each
 * by, and the catalogue entry it comes from, a plain string or a plural's form for one.
 *
 * The one list for both copies of them. The app hands them over in its own language at every
 * launch (`followNotificationWords`), and `scripts/generatePushWords.ts` writes every language's
 * into the native code, for a push that arrives before the app has ever run.
 */
export const PUSH_WORDS = {
  appName: { text: 'appName' },
  channel: { text: 'notificationsMessage' },
  generic: { one: 'messageNewYouveGot' },
  request: { text: 'messageRequestsNew' },
  you: { text: 'you' },
  image: { text: 'image' },
  animated: { text: 'gif' },
  video: { text: 'video' },
  audio: { text: 'audio' },
  voice: { text: 'messageVoice' },
  file: { text: 'document' },
  attachments: { text: 'attachments' },
} as const satisfies Record<string, { text: TokenSimpleNoArgs } | { one: TokenPluralWithArgs }>
