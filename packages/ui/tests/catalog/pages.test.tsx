import { describe, expect, it } from 'vitest'

import { catalogPages, type CatalogTier } from '#src/catalog/pages'

const TIERS: readonly CatalogTier[] = ['pr', 'nightly']

describe('catalogPages', () => {
  // The route looks a page up by id within its tier, and an id names the PNG Argos compares.
  it.each(TIERS)('gives every %s page its own id', (tier) => {
    const ids = catalogPages(tier).map((page) => page.id)
    const repeated = ids.filter((id, at) => ids.indexOf(id) !== at)
    expect(repeated).toEqual([])
  })

  // A role each theme colours for itself is only checked where every theme is drawn.
  it('draws a theme-sensitive story in every theme on a pull request', () => {
    const page = catalogPages('pr').find((each) => each.id === 'qrCode-recoveryPassword')
    expect(page?.themes).toEqual(['classic-dark', 'classic-light', 'ocean-dark', 'ocean-light'])
    const plain = catalogPages('pr').find((each) => each.id === 'radioIndicator-states')
    expect(plain?.themes).toEqual(['classic-dark', 'classic-light'])
  })
})
