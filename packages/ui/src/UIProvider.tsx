import type { PrimaryColorState, ThemeState } from '@session/theme-tokens'
import { createContext, useContext, useLayoutEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { TamaguiProvider } from 'tamagui'

import { BackdropBlurProvider, type BackdropBlur } from './backdropBlur'
import { config } from './config'
// Side-effecting: puts the compiled themes in the document on the web, and does nothing on native.
// See tamaguiCSS.ts - without it every `$token` colour resolves to an undefined custom property.
import './tamaguiCSS'
import {
  DEFAULT_ACCENT,
  DEFAULT_THEME,
  isDarkTheme,
  isThemeRegistered,
  registerTheme,
  themeName,
} from './themes'

export interface UIProviderProps {
  children: ReactNode
  theme?: ThemeState
  accent?: PrimaryColorState
  /**
   * What draws the blur behind a dialog, on the one platform that has one.
   *
   * Installed by the app rather than reached for here: see `backdropBlur.ts`. Null on Android and
   * left out on the desktop client, where a dialog simply darkens what is behind it.
   */
  backdropBlur?: BackdropBlur | null
}

/**
 * Wraps an app in the shared configuration and the theme it is currently showing.
 *
 * The theme name is resolved here rather than by the caller so that the accent
 * sub-theme convention stays inside this package.
 */
export function UIProvider({
  children,
  theme = DEFAULT_THEME,
  accent = DEFAULT_ACCENT,
  backdropBlur,
}: UIProviderProps) {
  // What tamagui is drawing. On the first mount the theme is registered before anything themed
  // exists to be woken by it, so the first frame is already in it. A theme that arrives later and
  // is new to tamagui is registered in the layout effect -- adding one wakes every mounted themed
  // component, which a render must not do -- and drawn a pass later, never painted in the old one.
  // One registered before it reaches here (see `registerStoredAppearance`) is drawn at once.
  const [shown, setShown] = useState(() => {
    registerTheme(theme, accent)
    return { theme, accent }
  })
  useLayoutEffect(() => {
    registerTheme(theme, accent)
    setShown((prev) => (prev.theme === theme && prev.accent === accent ? prev : { theme, accent }))
  }, [theme, accent])
  const drawn = isThemeRegistered(theme, accent) ? { theme, accent } : shown

  return (
    <TamaguiProvider config={config} defaultTheme={themeName(drawn.theme, drawn.accent)}>
      <ThemeIsDarkContext.Provider value={isDarkTheme(drawn.theme)}>
        <BackdropBlurProvider value={backdropBlur ?? null}>{children}</BackdropBlurProvider>
      </ThemeIsDarkContext.Provider>
    </TamaguiProvider>
  )
}

/**
 * Whether the app is currently showing a dark theme.
 *
 * Here rather than derived from tamagui's theme name, which carries the accent as well and would
 * have to be parsed back apart. The provider already knows the answer, so it says so.
 */
const ThemeIsDarkContext = createContext(isDarkTheme(DEFAULT_THEME))

export function useThemeIsDark(): boolean {
  return useContext(ThemeIsDarkContext)
}
