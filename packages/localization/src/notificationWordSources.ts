import type { TokenPluralWithArgs, TokenSimpleNoArgs } from './localization-src/generated/locales'

/**
 * The words a notification for a message is made of, wherever it is built: by name, the catalogue
 * entry each comes from, a plain string or a plural's form for one.
 *
 * Data alone, imported by nothing at run time, so that the generator that writes them into the
 * phones' native push handlers can read it under node: `notificationWords` is the app's side.
 */
export const NOTIFICATION_WORD_SOURCES = {
  appName: { text: 'appName' },
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
} as const satisfies Record<string, WordSource>

/** Where a word comes from in the catalogue. */
export type WordSource = { text: TokenSimpleNoArgs } | { one: TokenPluralWithArgs }

export type NotificationWordName = keyof typeof NOTIFICATION_WORD_SOURCES
