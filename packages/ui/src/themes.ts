import { addTheme } from 'tamagui'
import {
  getThemeTokens,
  type PrimaryColorState,
  type ThemeState,
  type ThemeTokens,
} from '@session/theme-tokens'

/**
 * The four themes, each in seven accents, generated rather than written out.
 *
 * Tamagui's naming convention is `parent_child`, so `classicDark` is the base and
 * `classicDark_green` is that base with an accent applied. A component asks for
 * `$primaryColor` and gets whichever accent is in force; nothing has to know the list.
 *
 * The token names are the ones @session/theme-tokens already publishes. Renaming them into a
 * second vocabulary here would only create two places to keep in step, and the semantic
 * layer those tokens describe is the portable part of the design across all the clients.
 */

export const THEME_STATES: readonly ThemeState[] = [
  'classic-dark',
  'classic-light',
  'ocean-dark',
  'ocean-light',
]

export const PRIMARY_COLORS: readonly PrimaryColorState[] = [
  'green',
  'blue',
  'yellow',
  'pink',
  'purple',
  'orange',
  'red',
]

/** `classic-dark` is the name a person picked; `classicDark` is what tamagui calls it. */
export function themeName(theme: ThemeState, accent?: PrimaryColorState): string {
  const base = theme.replace(/-(.)/g, (_, c: string) => c.toUpperCase())
  return accent === undefined ? base : `${base}_${accent}`
}

/**
 * Whether a theme is a dark one, which some platform materials have to be told.
 *
 * Read off the name rather than from a flag on the palette, because the name is what every theme
 * already carries and a second source would be one more thing to keep in step. Every theme is
 * `<family>-<light|dark>`; a family added without that suffix would be a new convention rather
 * than a new theme.
 */
export function isDarkTheme(theme: ThemeState): boolean {
  return theme.endsWith('-dark')
}

export const DEFAULT_THEME: ThemeState = 'classic-dark'
export const DEFAULT_ACCENT: PrimaryColorState = 'green'

/**
 * The theme and accent a stored choice names, each falling back to the default where this build
 * does not ship the name -- a preference outlives the build that wrote it.
 */
export function appearanceFrom(stored: { theme: string; accent: string } | null): {
  theme: ThemeState
  accent: PrimaryColorState
} {
  const theme = THEME_STATES.find((name) => name === stored?.theme) ?? DEFAULT_THEME
  const accent = PRIMARY_COLORS.find((name) => name === stored?.accent) ?? DEFAULT_ACCENT
  return { theme, accent }
}

/**
 * The names tamagui's own components reach for.
 *
 * Session's vocabulary is semantic and its own - `backgroundPrimary`, `textSecondary` - and
 * tamagui's built-ins know nothing about it: they ask for `$background`, `$colorHover`,
 * `$backgroundFocus` and the rest. A name no theme defines resolves to 0 in silence, so a
 * built-in with a gap here renders an invisible border or a transparent surface and reports
 * nothing.
 *
 * Written out in full rather than added one warning at a time, because that is a game of
 * whack-a-mole against whichever component someone happens to render next. These are aliases:
 * every colour still has exactly one definition, in @session/theme-tokens.
 */
const TAMAGUI_NAMES = [
  'background',
  'backgroundHover',
  'backgroundPress',
  'backgroundFocus',
  'backgroundStrong',
  'backgroundTransparent',
  'color',
  'colorHover',
  'colorPress',
  'colorFocus',
  'colorTransparent',
  'placeholderColor',
  'borderColor',
  'borderColorHover',
  'borderColorPress',
  'borderColorFocus',
  'outlineColor',
  'shadowColor',
  'shadowColorHover',
  'shadowColorPress',
  'shadowColorFocus',
] as const

/** The list above is what must exist; this is what each one means in Session's terms. */
function tamaguiAliases(tokens: ThemeTokens): Record<(typeof TAMAGUI_NAMES)[number], string> {
  const clear = 'rgba(0, 0, 0, 0)'
  const shadow = 'rgba(0, 0, 0, 0.25)'

  return {
    background: tokens.backgroundPrimary,
    backgroundHover: tokens.backgroundSecondary,
    backgroundPress: tokens.backgroundTertiary,
    backgroundFocus: tokens.backgroundSecondary,
    backgroundStrong: tokens.backgroundPrimary,
    backgroundTransparent: clear,
    color: tokens.textPrimary,
    colorHover: tokens.textPrimary,
    colorPress: tokens.textPrimary,
    // Focus is the one that takes the accent: it is the only one of these that is meant to
    // be noticed, and it is how a keyboard user knows where they are.
    colorFocus: tokens.textPrimary,
    colorTransparent: clear,
    placeholderColor: tokens.textSecondary,
    borderColor: tokens.bordersColor,
    borderColorHover: tokens.bordersColor,
    borderColorPress: tokens.bordersColor,
    borderColorFocus: tokens.primaryColor,
    outlineColor: tokens.primaryColor,
    shadowColor: shadow,
    shadowColorHover: shadow,
    shadowColorPress: shadow,
    shadowColorFocus: shadow,
  }
}

export { TAMAGUI_NAMES }

function toTamaguiTheme(tokens: ThemeTokens): Record<string, string> {
  return {
    // Tamagui wants a flat record of colour values; ThemeTokens already is one.
    ...tokens,
    ...tamaguiAliases(tokens),
  }
}

/**
 * The one theme a name stands for: a base theme carries the default accent, so a component drawn
 * outside any accent sub-theme still resolves `$primaryColor`.
 */
function tamaguiThemeFor(theme: ThemeState, accent?: PrimaryColorState): Record<string, string> {
  return toTamaguiTheme(getThemeTokens(theme, accent ?? DEFAULT_ACCENT))
}

/**
 * What the configuration is created with: the default theme, and the pair tamagui needs by name.
 * Every other theme is registered the first time it is shown -- see `registerTheme`.
 *
 * `dark` and `light` are not spare themes, they are what makes the rest of them work on the web.
 * Tamagui compiles a theme into a CSS rule whose selector list it assembles from the theme names,
 * and it only starts that list for a theme literally called `dark` or `light`
 * (see getThemeCSSRules). Every name here is `classicDark`-shaped, so without them the list came
 * out empty and the rule with it: `, .tm_xxt { ... }`, a leading comma, which is invalid CSS that
 * every browser drops without a word, and no `$token` colour resolved on the desktop at all. They
 * are the classic pair; nothing selects them by name.
 */
export function initialThemes(): Record<string, Record<string, string>> {
  return {
    dark: tamaguiThemeFor('classic-dark'),
    light: tamaguiThemeFor('classic-light'),
    [themeName(DEFAULT_THEME)]: tamaguiThemeFor(DEFAULT_THEME),
    [themeName(DEFAULT_THEME, DEFAULT_ACCENT)]: tamaguiThemeFor(DEFAULT_THEME, DEFAULT_ACCENT),
  }
}

/**
 * Every theme there is, base and accent sub-theme alike. Not what the app registers -- that is
 * `initialThemes` and then `registerTheme` -- but what the contract tests hold each one to.
 */
export function buildThemes(): Record<string, Record<string, string>> {
  const themes = initialThemes()
  for (const theme of THEME_STATES) {
    themes[themeName(theme)] = tamaguiThemeFor(theme)
    for (const accent of PRIMARY_COLORS) {
      themes[themeName(theme, accent)] = tamaguiThemeFor(theme, accent)
    }
  }
  return themes
}

/** The names tamagui already has, so a theme is derived and added once. */
const registered = new Set(Object.keys(initialThemes()))

/**
 * Adds a theme to tamagui the first time it is asked for, and says its name.
 *
 * **Registered when first shown, not at launch**, so launch does not grow with the number of
 * themes a person can make. On the web `addTheme` writes the theme's CSS as it goes, which is the
 * part `getCSS()` did for the initial ones.
 */
export function registerTheme(theme: ThemeState, accent: PrimaryColorState): string {
  for (const [name, values] of [
    [themeName(theme), tamaguiThemeFor(theme)],
    [themeName(theme, accent), tamaguiThemeFor(theme, accent)],
  ] as const) {
    if (registered.has(name)) continue
    addTheme({ name, theme: values, insertCSS: true })
    registered.add(name)
  }
  return themeName(theme, accent)
}

/** Whether a theme can be shown without registering it first. */
export function isThemeRegistered(theme: ThemeState, accent: PrimaryColorState): boolean {
  return registered.has(themeName(theme, accent))
}
