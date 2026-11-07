import { describe, expect, it } from 'vitest'

import { PRIMARY_COLOR_HEX, type PrimaryColorState } from '#src/colors'
import { deriveTokens, getThemeKnobs } from '#src/themeTokens'

const ACCENT_ROLES = [
  'primaryColor',
  'onAccent',
  'onAccentSecondary',
  'accentText',
  'accentHover',
  'accentPressed',
]

/**
 * The accent-independent half of a theme is derived once per set of knobs and shared by every
 * accent, which is only right if an accent really reaches nothing else.
 */
describe('an accent', () => {
  it('changes only the accent roles', () => {
    const knobs = getThemeKnobs('ocean-dark')
    const accents = Object.values(PRIMARY_COLOR_HEX)
    const themes = accents.map((accent) => deriveTokens(knobs, accent))
    const [first, ...rest] = themes.map((theme) =>
      Object.fromEntries(Object.entries(theme).filter(([role]) => !ACCENT_ROLES.includes(role))),
    )
    for (const other of rest) expect(other).toEqual(first)
  })

  it('gives the same theme on a second derivation as on the first', () => {
    const knobs = getThemeKnobs('classic-light')
    const accent = PRIMARY_COLOR_HEX['blue' satisfies PrimaryColorState]
    expect(deriveTokens(knobs, accent)).toEqual(deriveTokens(knobs, accent))
  })
})
