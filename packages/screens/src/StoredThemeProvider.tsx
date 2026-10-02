import { useAppearance, useHydrated, useStartupError, type SessionStore } from '@session/state'
import { appearanceFrom, registerTheme, UIProvider, type UIProviderProps } from '@session/ui'

import { useFirstPaintHeld } from './firstPaintHold'

/**
 * The UI provider, in the theme the account chose.
 *
 * Inside the store's provider, since the choice is read with the account. Until then -- and on a
 * device with no account -- it is the default theme.
 *
 * **Nothing is drawn until the choice is known**: until the start has read the account or failed,
 * for at most `FIRST_PAINT_HOLD_MS` from launch. Otherwise the launch screen would be drawn in the
 * default theme and redrawn in the chosen one. What shows meanwhile is what the platform draws
 * behind the app.
 *
 * On the desktop that is the window's own background, which main paints in the account's theme.
 * TODO: on the phones it is the system's root view until the native splash is held over this
 * (expo-splash-screen, M337).
 */
export function StoredThemeProvider(props: Omit<UIProviderProps, 'theme' | 'accent'>) {
  const hydrated = useHydrated()
  const failed = useStartupError() !== null
  const held = useFirstPaintHeld(hydrated || failed)
  const { theme, accent } = appearanceFrom(useAppearance())
  if (held) return null
  return <UIProvider {...props} theme={theme} accent={accent} />
}

/**
 * Registers the account's theme with the UI as soon as the store has it.
 *
 * A subscription rather than a render, because the store tells its own listeners before React
 * draws the update: the theme is registered by the time `StoredThemeProvider` is asked to show
 * it, so the update is drawn once rather than once in the old theme and again in the new.
 * Returns the unsubscribe.
 */
export function registerStoredAppearance(store: SessionStore): () => void {
  return store.subscribe((state, previous) => {
    if (state.appearance === previous.appearance) return
    const { theme, accent } = appearanceFrom(state.appearance)
    registerTheme(theme, accent)
  })
}
