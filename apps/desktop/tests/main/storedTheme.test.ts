import type { Request, Response } from '@session/client'
import { ACCENT_PREF, THEME_PREF } from '@session/state'
import { DEFAULT_ACCENT, DEFAULT_THEME } from '@session/theme-tokens'
import { describe, expect, it } from 'vitest'

import { routeFrames } from '#src/main/frameRouter'
import { readStoredTheme } from '#src/main/storedTheme'

import { stubBridge } from './stubBridge'

/** Answers `getPref` from `prefs`, as libsession would. */
const prefsFrom =
  (prefs: Record<string, string>) =>
  (request: Request): Omit<Response, 'id'> => {
    if (request.command.type !== 'getPref') return { error: 'unexpected' }
    const value = prefs[request.command.key]
    return { result: { type: 'pref', ...(value === undefined ? {} : { value }) } }
  }

const read = (respond?: (request: Request) => Omit<Response, 'id'>, timeoutMs?: number) =>
  readStoredTheme(routeFrames(stubBridge(respond === undefined ? {} : { respond })), timeoutMs)

describe('the theme a window opens on', () => {
  it('is the one the account stored', async () => {
    const stored = prefsFrom({ [THEME_PREF]: 'ocean-light', [ACCENT_PREF]: 'pink' })
    await expect(read(stored)).resolves.toEqual({ theme: 'ocean-light', accent: 'pink' })
  })

  it('is the default when only half a choice is stored', async () => {
    await expect(read(prefsFrom({ [THEME_PREF]: 'ocean-light' }))).resolves.toEqual({
      theme: DEFAULT_THEME,
      accent: DEFAULT_ACCENT,
    })
  })

  it('falls back on each name this build does not ship', async () => {
    const stored = prefsFrom({ [THEME_PREF]: 'sunset-dark', [ACCENT_PREF]: 'pink' })
    await expect(read(stored)).resolves.toEqual({ theme: DEFAULT_THEME, accent: 'pink' })
  })

  it('is the default when the bridge refuses', async () => {
    await expect(read(() => ({ error: 'no database' }))).resolves.toEqual({
      theme: DEFAULT_THEME,
      accent: DEFAULT_ACCENT,
    })
  })

  it('does not wait past its timeout for a bridge that never answers', async () => {
    await expect(read(undefined, 10)).resolves.toEqual({
      theme: DEFAULT_THEME,
      accent: DEFAULT_ACCENT,
    })
  })
})
