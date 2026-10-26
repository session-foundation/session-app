import { describe, expect, it } from 'vitest'

import { fittedFontSize } from '#src/fittedFontSize'

describe('fitting a line to its box', () => {
  it('leaves a line that fits at its size', () => {
    expect(fittedFontSize(13, 80, 60)).toBeNull()
    expect(fittedFontSize(13, 60, 60)).toBeNull()
  })

  it('shrinks a line that overflows by the share it overflows', () => {
    expect(fittedFontSize(12, 46, 60)).toBe(9)
  })

  it('stops at half its size, past which it truncates', () => {
    expect(fittedFontSize(12, 10, 60)).toBe(6)
  })

  it('does nothing for a box with no width yet', () => {
    expect(fittedFontSize(12, 0, 60)).toBeNull()
  })
})
