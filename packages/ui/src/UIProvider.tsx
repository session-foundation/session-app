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
  // What tamagui is drawing, which trails `theme` by one layout pass when the theme is new to it:
  // it is registered in an effect, since adding one updates every mounted themed component and a
  // render cannot do that. A layout effect, so the frame drawn in the old theme is never painted.
  const [shown, setShown] = useState(() =>
    isThemeRegistered(theme, accent)
      ? { theme, accent }
      : { theme: DEFAULT_THEME, accent: DEFAULT_ACCENT },
  )
  useLayoutEffect(() => {
    registerTheme(theme, accent)
    setShown({ theme, accent })
  }, [theme, accent])

  return (
    <TamaguiProvider config={config} defaultTheme={themeName(shown.theme, shown.accent)}>
      <ThemeIsDarkContext.Provider value={isDarkTheme(shown.theme)}>
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
