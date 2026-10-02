import { useAppearance, type SessionStore } from '@session/state'
import { appearanceFrom, registerTheme, UIProvider, type UIProviderProps } from '@session/ui'

/**
 * The UI provider, in the theme the account chose.
 *
 * Inside the store's provider, since the choice is read with the account. Until then -- and on a
 * device with no account -- it is the default theme.
 *
 * TODO: the stored theme arrives with the account, so the launch screen is drawn in the default
 * one first. Holding the first paint until it is read closes that: on the desktop the main process
 * has the bridge before the window and can read it there; on the phones the native splash would
 * stay up until `start` has it, which needs expo-splash-screen.
 */
export function StoredThemeProvider(props: Omit<UIProviderProps, 'theme' | 'accent'>) {
  const { theme, accent } = appearanceFrom(useAppearance())
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
