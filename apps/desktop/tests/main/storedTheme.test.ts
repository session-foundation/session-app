import { createSessionClient, type SessionClient } from '@session/client'
import { createFakeTransport, newcomer } from '@session/client/fake'
import { ACCENT_PREF, THEME_PREF } from '@session/state'
import { DEFAULT_ACCENT, DEFAULT_THEME } from '@session/theme-tokens'
import { describe, expect, it } from 'vitest'

import { shareBridge } from '#src/main/shareBridge'
import { readStoredTheme } from '#src/main/storedTheme'

/** Main's client over the fake, as the app wires it: through its half of a shared bridge. */
function mainClient(prefs: Record<string, string>): SessionClient {
  const alice = newcomer().clients['Alice']
  if (alice === undefined) throw new Error('the fixture did not produce a client')
  for (const [key, value] of Object.entries(prefs)) void alice.setPref(key, value)
  return createSessionClient(shareBridge(createFakeTransport(alice)).main)
}

describe('the theme a window opens on', () => {
  it('is the one the account stored', async () => {
    const client = mainClient({ [THEME_PREF]: 'ocean-light', [ACCENT_PREF]: 'pink' })
    await expect(readStoredTheme(client)).resolves.toEqual({ theme: 'ocean-light', accent: 'pink' })
  })

  it('is the default when only half a choice is stored', async () => {
    await expect(readStoredTheme(mainClient({ [THEME_PREF]: 'ocean-light' }))).resolves.toEqual({
      theme: DEFAULT_THEME,
      accent: DEFAULT_ACCENT,
    })
  })

  it('falls back on each name this build does not ship', async () => {
    const client = mainClient({ [THEME_PREF]: 'sunset-dark', [ACCENT_PREF]: 'pink' })
    await expect(readStoredTheme(client)).resolves.toEqual({ theme: DEFAULT_THEME, accent: 'pink' })
  })

  it('is the default when the bridge refuses', async () => {
    const refusing = { getPref: () => Promise.reject(new Error('no database')) }
    await expect(readStoredTheme(refusing)).resolves.toEqual({
      theme: DEFAULT_THEME,
      accent: DEFAULT_ACCENT,
    })
  })

  it('does not wait past its timeout for a bridge that never answers', async () => {
    const silent = { getPref: () => new Promise<string | undefined>(() => {}) }
    await expect(readStoredTheme(silent, 10)).resolves.toEqual({
      theme: DEFAULT_THEME,
      accent: DEFAULT_ACCENT,
    })
  })
})
