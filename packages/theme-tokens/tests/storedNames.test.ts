import { describe, expect, it } from 'vitest'

import { DEFAULT_ACCENT, DEFAULT_THEME, isPrimaryColorState } from '#src/colors'
import { appearanceFrom, isThemeState } from '#src/themeTokens'

describe('a stored name', () => {
  it('is a theme only when this build ships it', () => {
    expect(isThemeState('ocean-light')).toBe(true)
    expect(isThemeState('sunset-dark')).toBe(false)
    expect(isThemeState('toString')).toBe(false)
  })

  it('is an accent only when this build ships it', () => {
    expect(isPrimaryColorState('pink')).toBe(true)
    expect(isPrimaryColorState('teal')).toBe(false)
    expect(isPrimaryColorState('constructor')).toBe(false)
  })
})

describe('appearanceFrom', () => {
  it('names the stored theme and accent', () => {
    expect(appearanceFrom({ theme: 'ocean-dark', accent: 'pink' })).toEqual({
      theme: 'ocean-dark',
      accent: 'pink',
    })
  })

  it('falls back per half to the default for a name this build does not ship', () => {
    expect(appearanceFrom({ theme: 'sunset-dark', accent: 'pink' })).toEqual({
      theme: DEFAULT_THEME,
      accent: 'pink',
    })
    expect(appearanceFrom({ theme: 'ocean-dark', accent: 'teal' })).toEqual({
      theme: 'ocean-dark',
      accent: DEFAULT_ACCENT,
    })
    expect(appearanceFrom(null)).toEqual({ theme: DEFAULT_THEME, accent: DEFAULT_ACCENT })
  })
})
