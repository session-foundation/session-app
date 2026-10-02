import { describe, expect, it } from 'vitest'

import { isPrimaryColorState } from '#src/colors'
import { isThemeState } from '#src/themeTokens'

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
