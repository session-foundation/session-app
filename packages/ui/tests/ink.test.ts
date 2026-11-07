import { describe, expect, it } from 'vitest'

import { inkFor, type InkTone } from '#src/ink'

const TONES: InkTone[] = ['primary', 'secondary', 'danger', 'link']

describe('ink on an accent fill', () => {
  it('is an on-colour in every tone, whatever the tone draws on the page', () => {
    for (const tone of TONES.filter((t) => t !== 'secondary'))
      expect(inkFor(tone, true).color).toBe('$onAccent')
    expect(inkFor('secondary', true).color).toBe('$onAccentSecondary')
  })
})

describe('ink on the page', () => {
  it('is the tone’s own role, and never an on-colour', () => {
    expect(inkFor('primary', false).color).toBe('$textPrimary')
    expect(inkFor('secondary', false).color).toBe('$textSecondary')
    expect(inkFor('danger', false).color).toBe('$dangerColor')
    expect(inkFor('link', false).color).toBe('$accentText')
  })
})
