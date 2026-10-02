import { describe, expect, it } from 'vitest'

import { FIRST_PAINT_HOLD_MS, holdRemainingMs } from '#src/firstPaintHold'

describe('the first-paint hold', () => {
  it('counts down from launch, not from whoever asks', () => {
    expect(holdRemainingMs(1_000, 1_000)).toBe(FIRST_PAINT_HOLD_MS)
    expect(holdRemainingMs(1_400, 1_000)).toBe(FIRST_PAINT_HOLD_MS - 400)
  })

  it('never goes below zero, so a slow start still draws', () => {
    expect(holdRemainingMs(1_000 + FIRST_PAINT_HOLD_MS * 5, 1_000)).toBe(0)
  })
})
