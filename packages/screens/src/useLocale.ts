import {
  deviceLocale,
  followingSystemLocale,
  getLocale,
  subscribeLocale,
  type CrowdinLocale,
} from '@session/localization'
import { useSyncExternalStore } from 'react'

/**
 * The language in use, re-rendering whoever asks when it changes.
 *
 * `tr()` reads a module-scope variable, which is the right shape for a function called from
 * anywhere but means nothing re-renders when the language changes. This is the adapter between
 * that and React, and it lives here rather than in `@session/localization` because that package
 * has no React and should not grow one for a six-line hook.
 *
 * `useSyncExternalStore` rather than an effect and a state: the language can change between a
 * render and the effect that would have subscribed, and this is the API that exists to close that
 * gap. The third argument is the server snapshot, which never runs here -- neither app server-side
 * renders -- but omitting it makes the hook throw under any renderer that does.
 */
export function useLocale(): CrowdinLocale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale)
}

/**
 * The value of the row that follows the device, which is not a locale and must not collide with
 * one. Crowdin's codes are BCP-47, where a leading `@` cannot appear.
 */
export const SYSTEM_LOCALE = '@system'

export type LocaleChoice = CrowdinLocale | typeof SYSTEM_LOCALE

function choice(): LocaleChoice {
  return followingSystemLocale() ? SYSTEM_LOCALE : getLocale()
}

/**
 * Which row the picker should tick: a language, or the one that follows the device.
 *
 * Separate from `useLocale` because they answer different questions and only one of them moves
 * here. "The device's English" and "English, chosen" are the same language and different choices,
 * and the store notifies on the change between them -- but `useSyncExternalStore` compares
 * snapshots with `Object.is` and drops a notification whose snapshot is equal, so a hook watching
 * the language alone never re-renders and the tick stays on the row it was on.
 *
 * A string rather than a pair, because the snapshot has to be stable: a fresh object each call is
 * never equal to the last and the hook loops.
 */
export function useLocaleChoice(): LocaleChoice {
  return useSyncExternalStore(subscribeLocale, choice, choice)
}

function formattingLocale(): string | undefined {
  if (followingSystemLocale()) return undefined
  const picked = getLocale()
  return picked === deviceLocale() ? undefined : picked
}

/**
 * The locale to format dates, times and numbers in, or undefined for the runtime's default.
 *
 * Undefined is the device's own locale, region and all, and the region is what decides day-first
 * or month-first and the 12- or 24-hour clock. A language picked here carries no region, so it is
 * passed on only when it differs from the device's language: somebody in the UK who picks English
 * keeps en-GB's conventions rather than getting en-US's. Separate from `useLocaleChoice`, which the
 * language picker needs as it is.
 */
export function useFormattingLocale(): string | undefined {
  return useSyncExternalStore(subscribeLocale, formattingLocale, formattingLocale)
}
