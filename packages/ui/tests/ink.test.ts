import { describe, expect, it } from 'vitest'

import { inkFor, ON_ACCENT_SECONDARY_OPACITY, type InkTone } from '#src/ink'

const TONES: InkTone[] = ['primary', 'secondary', 'danger', 'link']

describe('ink on an accent fill', () => {
  it('is $onAccent in every tone, whatever the tone draws on the page', () => {
    for (const tone of TONES) expect(inkFor(tone, true).color).toBe('$onAccent')
  })

  it('dims only secondary text, and no further than the floor', () => {
    expect(inkFor('secondary', true).opacity).toBe(ON_ACCENT_SECONDARY_OPACITY)
    expect(ON_ACCENT_SECONDARY_OPACITY).toBeGreaterThanOrEqual(0.85)
    for (const tone of TONES.filter((t) => t !== 'secondary'))
      expect(inkFor(tone, true).opacity).toBe(1)
  })
})

describe('ink on the page', () => {
  it('is the tone’s own role, at full strength, and never $onAccent', () => {
    expect(inkFor('primary', false)).toEqual({ color: '$textPrimary', opacity: 1 })
    expect(inkFor('secondary', false)).toEqual({ color: '$textSecondary', opacity: 1 })
    expect(inkFor('danger', false)).toEqual({ color: '$dangerColor', opacity: 1 })
    expect(inkFor('link', false)).toEqual({ color: '$accentText', opacity: 1 })
  })
})
