import { describe, expect, it } from 'vitest'

import { storedAppearance } from '#src/prefs'

describe('a stored appearance', () => {
  it('is the pair when both halves are stored', () => {
    expect(storedAppearance('ocean-light', 'pink')).toEqual({
      theme: 'ocean-light',
      accent: 'pink',
    })
  })

  it('is nothing when either half is missing', () => {
    expect(storedAppearance('ocean-light', undefined)).toBeNull()
    expect(storedAppearance(undefined, 'pink')).toBeNull()
    expect(storedAppearance(undefined, undefined)).toBeNull()
  })
})
