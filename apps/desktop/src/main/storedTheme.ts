import { ACCENT_PREF, THEME_PREF } from '@session/state'
import {
  DEFAULT_ACCENT,
  DEFAULT_THEME,
  isPrimaryColorState,
  isThemeState,
  type PrimaryColorState,
  type ThemeState,
} from '@session/theme-tokens'

import type { FrameRouter } from './frameRouter'

/** How long a window waits for the account's theme before opening on the default's. */
const STORED_THEME_TIMEOUT_MS = 500

export interface StoredTheme {
  theme: ThemeState
  accent: PrimaryColorState
}

/**
 * The account's theme, asked of the bridge before there is a window to ask it.
 *
 * Falls back the way the renderer's store does: theme and accent both or neither, each to its
 * default where this build does not ship the name. A refusal or no answer is the default too.
 */
export async function readStoredTheme(
  frames: FrameRouter,
  timeoutMs: number = STORED_THEME_TIMEOUT_MS,
): Promise<StoredTheme> {
  async function read(key: string): Promise<string | undefined> {
    const { result } = await frames.request({ type: 'getPref', key })
    return result?.type === 'pref' ? result.value : undefined
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      resolve(undefined)
    }, timeoutMs)
  })
  const stored = await Promise.race([Promise.all([read(THEME_PREF), read(ACCENT_PREF)]), timedOut])
  clearTimeout(timer)

  const [theme, accent] = stored ?? []
  const chosen = theme !== undefined && accent !== undefined
  return {
    theme: chosen && isThemeState(theme) ? theme : DEFAULT_THEME,
    accent: chosen && isPrimaryColorState(accent) ? accent : DEFAULT_ACCENT,
  }
}
