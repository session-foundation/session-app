import { describe, expect, it } from 'vitest'

import { avatarPairLayout } from '#src/avatarPair'

describe('a two-member avatar', () => {
  it('draws the design’s discs at the size the conversation list uses', () => {
    expect(avatarPairLayout(48)).toEqual({ backPx: 32, frontPx: 34, ringPx: 2 })
  })

  it('keeps the proportions at another size, in whole pixels', () => {
    const { backPx, frontPx } = avatarPairLayout(40)
    expect(backPx).toBe(27)
    expect(frontPx).toBe(28)
    expect(Number.isInteger(backPx) && Number.isInteger(frontPx)).toBe(true)
  })

  it('keeps the ring a hairline at every size', () => {
    for (const size of [32, 48, 64, 96]) expect(avatarPairLayout(size).ringPx).toBe(2)
  })

  it('draws the front disc larger, so it reads as in front', () => {
    for (const size of [32, 40, 48, 64]) {
      const { backPx, frontPx } = avatarPairLayout(size)
      expect(frontPx).toBeGreaterThanOrEqual(backPx)
    }
  })

  it('fits both discs in the square, overlapping', () => {
    for (const size of [32, 40, 48, 64]) {
      const { backPx, frontPx } = avatarPairLayout(size)
      expect(backPx).toBeLessThan(size)
      expect(frontPx).toBeLessThan(size)
      // Pinned to opposite corners, they overlap only if together they are wider than the square.
      expect(backPx + frontPx).toBeGreaterThan(size)
    }
  })
})
