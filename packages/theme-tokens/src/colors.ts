export type ThemeState = 'classic-light' | 'classic-dark' | 'ocean-light' | 'ocean-dark'

export type PrimaryColorState = 'green' | 'blue' | 'yellow' | 'pink' | 'purple' | 'orange' | 'red'

/** What every app opens with until a theme is chosen; desktop main paints the window with it. */
export const DEFAULT_THEME: ThemeState = 'classic-dark'
export const DEFAULT_ACCENT: PrimaryColorState = 'green'

/** A theme and accent this build ships, as the UI is told to draw. */
export interface Appearance {
  theme: ThemeState
  accent: PrimaryColorState
}

type ClassicThemeScale = {
  DANGER: string
  WARNING: string
  DISABLED: string
  COLOR0: string
  COLOR1: string
  COLOR2: string
  COLOR3: string
  COLOR4: string
  COLOR5: string
  COLOR6: string
}

type OceanThemeScale = ClassicThemeScale & { COLOR7: string }

export const COLORS = {
  PRIMARY: {
    green: '#31F196',
    blue: '#57C9FA',
    yellow: '#FAD657',
    pink: '#FF95EF',
    purple: '#C993FF',
    orange: '#FCB159',
    red: '#FF9C8E',
  },
  PATH: {
    DEFAULT: '#31F196',
    CONNECTING: '#FCB159',
    ERROR: '#EA5545',
  },
  TRANSPARENT: 'transparent',
  WHITE: '#FFF',
  BLACK: '#000',
  NEARBLACK: '#0d0d0d',
  GREY: '#616161',
} as const

export const THEMES: {
  CLASSIC_LIGHT: ClassicThemeScale
  CLASSIC_DARK: ClassicThemeScale
  OCEAN_LIGHT: OceanThemeScale
  OCEAN_DARK: OceanThemeScale
} = {
  CLASSIC_LIGHT: {
    DANGER: '#E12D19',
    WARNING: '#A64B00',
    DISABLED: '#A1A2A1',
    COLOR0: '#000000',
    COLOR1: '#6D6D6D',
    COLOR2: '#A1A2A1',
    COLOR3: '#DFDFDF',
    COLOR4: '#F0F0F0',
    COLOR5: '#F9F9F9',
    COLOR6: '#FFFFFF',
  },
  CLASSIC_DARK: {
    DANGER: '#FF3A3A',
    WARNING: '#FCB159',
    DISABLED: '#6D6D6D',
    COLOR0: '#000000',
    COLOR1: '#1B1B1B',
    COLOR2: '#2D2D2D',
    COLOR3: '#414141',
    COLOR4: '#767676',
    COLOR5: '#A1A2A1',
    COLOR6: '#FFFFFF',
  },
  OCEAN_LIGHT: {
    DANGER: '#E12D19',
    WARNING: '#A64B00',
    DISABLED: '#A1A2A1',
    COLOR0: '#000000',
    COLOR1: '#19345D',
    COLOR2: '#6A6E90',
    COLOR3: '#5CAACC',
    COLOR4: '#B3EDF2',
    COLOR5: '#E7F3F4',
    COLOR6: '#ECFAFB',
    COLOR7: '#FCFFFF',
  },
  OCEAN_DARK: {
    DANGER: '#FF3A3A',
    WARNING: '#FCB159',
    DISABLED: '#6D6D6D',
    COLOR0: '#000000',
    COLOR1: '#1A1C28',
    COLOR2: '#252735',
    COLOR3: '#2B2D40',
    COLOR4: '#3D4A5D',
    COLOR5: '#A6A9CE',
    COLOR6: '#5CAACC',
    COLOR7: '#FFFFFF',
  },
}

export const PRIMARY_COLOR_HEX: Record<PrimaryColorState, string> = {
  green: COLORS.PRIMARY.green,
  blue: COLORS.PRIMARY.blue,
  yellow: COLORS.PRIMARY.yellow,
  pink: COLORS.PRIMARY.pink,
  purple: COLORS.PRIMARY.purple,
  orange: COLORS.PRIMARY.orange,
  red: COLORS.PRIMARY.red,
}

/** Whether a stored accent name is one this build ships. */
export function isPrimaryColorState(name: string): name is PrimaryColorState {
  return Object.hasOwn(PRIMARY_COLOR_HEX, name)
}
