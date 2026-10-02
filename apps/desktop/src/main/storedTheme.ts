import type { SessionClient } from '@session/client'
import { ACCENT_PREF, THEME_PREF, storedAppearance } from '@session/state'
import { appearanceFrom, type Appearance } from '@session/theme-tokens'

/** How long a window waits for the account's theme before opening on the default's. */
const STORED_THEME_TIMEOUT_MS = 500

/**
 * The account's theme, asked of main's client before there is a window to ask it.
 *
 * Falls back the way the renderer does, through the same two helpers; a refusal or no answer in
 * time is the default.
 */
export async function readStoredTheme(
  client: Pick<SessionClient, 'getPref'>,
  timeoutMs: number = STORED_THEME_TIMEOUT_MS,
): Promise<Appearance> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      resolve(null)
    }, timeoutMs)
  })
  const read = Promise.all([client.getPref(THEME_PREF), client.getPref(ACCENT_PREF)]).then(
    ([theme, accent]) => storedAppearance(theme, accent),
  )
  const stored = await Promise.race([read, timedOut]).catch(() => null)
  clearTimeout(timer)
  return appearanceFrom(stored)
}
