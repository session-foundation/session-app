import type { StoredAppearance } from './types'

/**
 * Where the account's theme and accent are kept, as libsession preferences. Desktop main reads
 * them too, to open its window on the account's page rather than the default's.
 */
export const THEME_PREF = 'appearance.theme'
export const ACCENT_PREF = 'appearance.accent'

/** Both or neither: an accent without its theme is half a choice. */
export function storedAppearance(
  theme: string | undefined,
  accent: string | undefined,
): StoredAppearance | null {
  return theme === undefined || accent === undefined ? null : { theme, accent }
}
