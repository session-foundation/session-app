import { tr } from './localization-src/localeTools'
import {
  NOTIFICATION_WORD_SOURCES,
  type NotificationWordName,
  type WordSource,
} from './notificationWordSources'

/** A word as the current language has it: a plural's form for one is `tr` with a count of 1. */
export function word(from: WordSource): string {
  return 'text' in from ? tr(from.text) : tr(from.one, { count: 1 })
}

/**
 * The words a notification for a message is made of, in the current language: desktop builds its
 * notifications from them, and the phones hand them to their native push handlers.
 */
export function notificationWords(): Record<NotificationWordName, string> {
  const words = {} as Record<NotificationWordName, string>
  for (const [name, from] of Object.entries(NOTIFICATION_WORD_SOURCES))
    words[name as NotificationWordName] = word(from)
  return words
}
