import type { BridgeTransport, Frame, Request } from '@session/client'
import { ACCENT_PREF, THEME_PREF } from '@session/state'
import { DEFAULT_ACCENT, DEFAULT_THEME } from '@session/theme-tokens'
import { describe, expect, it } from 'vitest'

import { readStoredTheme } from '#src/main/storedTheme'

/** A frame the renderer is owed: an answer to one of its own requests. */
const owed = (id: number): Frame => ({
  type: 'response',
  response: { id, result: { type: 'empty' } },
})

/**
 * A bridge that buffers frames until its first sink, as the real one does, and answers `getPref`
 * from `prefs` -- or not at all when `silent`.
 */
function bridgeWith(
  prefs: Record<string, string>,
  options: { early?: Frame[]; silent?: boolean; refuse?: boolean } = {},
): BridgeTransport & { sent: Request[]; emit(frame: Frame): void } {
  let sink: ((frame: Frame) => void) | null = null
  const pending = [...(options.early ?? [])]
  const sent: Request[] = []
  const emit = (frame: Frame): void => {
    if (sink) sink(frame)
    else pending.push(frame)
  }
  return {
    sent,
    emit,
    send(request) {
      sent.push(request)
      if (options.silent || request.command.type !== 'getPref') return
      const { id } = request
      const value = prefs[request.command.key]
      queueMicrotask(() => {
        emit(
          options.refuse
            ? { type: 'response', response: { id, error: 'no database' } }
            : {
                type: 'response',
                response: {
                  id,
                  result: { type: 'pref', ...(value === undefined ? {} : { value }) },
                },
              },
        )
      })
    },
    setSink(onFrame) {
      sink = onFrame
      for (const frame of pending.splice(0, pending.length)) onFrame(frame)
    },
    close() {},
  }
}

const stored = { [THEME_PREF]: 'ocean-light', [ACCENT_PREF]: 'pink' }

describe('the theme a window opens on', () => {
  it('is the one the account stored', async () => {
    const { theme, accent } = await readStoredTheme(bridgeWith(stored))
    expect({ theme, accent }).toEqual({ theme: 'ocean-light', accent: 'pink' })
  })

  it('hands the window every other frame, in the order it came', async () => {
    const bridge = bridgeWith(stored, { early: [owed(1), owed(2)] })
    const { bridge: forWindow } = await readStoredTheme(bridge)
    bridge.emit(owed(3))

    const seen: Frame[] = []
    forWindow.setSink((frame) => seen.push(frame))
    bridge.emit(owed(4))

    expect(seen).toEqual([owed(1), owed(2), owed(3), owed(4)])
  })

  it('asks on ids the renderer never uses', async () => {
    const bridge = bridgeWith(stored)
    await readStoredTheme(bridge)
    expect(bridge.sent.every((request) => request.id < 0)).toBe(true)
  })

  it('is the default when only half a choice is stored', async () => {
    const { theme, accent } = await readStoredTheme(bridgeWith({ [THEME_PREF]: 'ocean-light' }))
    expect({ theme, accent }).toEqual({ theme: DEFAULT_THEME, accent: DEFAULT_ACCENT })
  })

  it('falls back on each name this build does not ship', async () => {
    const bridge = bridgeWith({ [THEME_PREF]: 'sunset-dark', [ACCENT_PREF]: 'pink' })
    const { theme, accent } = await readStoredTheme(bridge)
    expect({ theme, accent }).toEqual({ theme: DEFAULT_THEME, accent: 'pink' })
  })

  it('is the default when the bridge refuses', async () => {
    const { theme } = await readStoredTheme(bridgeWith(stored, { refuse: true }))
    expect(theme).toBe(DEFAULT_THEME)
  })

  it('does not wait past its timeout for a bridge that never answers', async () => {
    const { theme } = await readStoredTheme(bridgeWith(stored, { silent: true }), 10)
    expect(theme).toBe(DEFAULT_THEME)
  })
})
