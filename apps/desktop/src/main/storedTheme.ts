import type { BridgeTransport, Frame } from '@session/client'
import { ACCENT_PREF, THEME_PREF } from '@session/state'
import {
  DEFAULT_ACCENT,
  DEFAULT_THEME,
  isPrimaryColorState,
  isThemeState,
  type PrimaryColorState,
  type ThemeState,
} from '@session/theme-tokens'

/** How long a window waits for the account's theme before opening on the default's. */
const STORED_THEME_TIMEOUT_MS = 500

/**
 * Negative, because the renderer's client numbers its requests up from 1: an answer to one of
 * these that arrives after the window has its sink is dropped there as nobody's.
 */
let nextRequestId = -1

export interface StoredTheme<T extends BridgeTransport> {
  theme: ThemeState
  accent: PrimaryColorState
  /** The bridge to hand the window: its first sink gets every frame that arrived meanwhile. */
  bridge: T
}

/**
 * The account's theme, asked of the bridge before there is a window to ask it.
 *
 * **Every other frame is held and replayed, in order, to the next sink**: the bridge buffers frames
 * only until its first sink, so without this the renderer would lose the initial state to this read.
 * Falls back to the default the way the renderer's store does: theme and accent both or neither,
 * each to its default where this build does not ship the name.
 */
export async function readStoredTheme<T extends BridgeTransport>(
  bridge: T,
  timeoutMs: number = STORED_THEME_TIMEOUT_MS,
): Promise<StoredTheme<T>> {
  const held: Frame[] = []
  const answers = new Map<number, (value: string | undefined) => void>()

  bridge.setSink((frame) => {
    if (frame.type === 'response') {
      const answer = answers.get(frame.response.id)
      if (answer !== undefined) {
        const result = frame.response.result
        answer(result?.type === 'pref' ? result.value : undefined)
        return
      }
    }
    held.push(frame)
  })

  function read(key: string): Promise<string | undefined> {
    const id = nextRequestId--
    const answered = new Promise<string | undefined>((resolve) => answers.set(id, resolve))
    bridge.send({ id, command: { type: 'getPref', key } })
    return answered
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
    bridge: {
      ...bridge,
      setSink(onFrame: (frame: Frame) => void): void {
        for (const frame of held.splice(0, held.length)) onFrame(frame)
        bridge.setSink(onFrame)
      },
    },
  }
}
