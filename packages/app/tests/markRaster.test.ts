import { RECOVERY_PASSWORD_MARK, type MarkOutline } from '@session/basic-types'
import { describe, expect, it } from 'vitest'

import { rasterizeMark } from '#src/markRaster'

/** Whether the pixel holding the point (x, y), in the outline's own units, is ink. */
function inkAt(mark: MarkOutline, ink: Uint8Array, side: number, x: number, y: number): boolean {
  const scale = Math.min(side / mark.width, side / mark.height)
  const left = (side - mark.width * scale) / 2
  const top = (side - mark.height * scale) / 2
  return ink[Math.floor(top + y * scale) * side + Math.floor(left + x * scale)] === 1
}

describe('rasterizeMark', () => {
  it('fills a closed outline and leaves the rest of the box empty', () => {
    const square: MarkOutline = { width: 10, height: 10, path: 'M2 2H8V8H2Z' }
    const ink = rasterizeMark(square, 10, 10)
    expect(inkAt(square, ink, 10, 5, 5)).toBe(true)
    expect(inkAt(square, ink, 10, 0.5, 0.5)).toBe(false)
    expect(ink.reduce((sum, v) => sum + v, 0)).toBe(36)
  })

  it('leaves a hole where an inner outline winds the other way', () => {
    const ring: MarkOutline = { width: 10, height: 10, path: 'M0 0h10v10H0Zm3 3v4h4V3Z' }
    const ink = rasterizeMark(ring, 10, 10)
    expect(inkAt(ring, ink, 10, 1, 5)).toBe(true)
    expect(inkAt(ring, ink, 10, 5, 5)).toBe(false)
  })

  it('draws arcs, flags written without separators included', () => {
    // A circle from two half arcs, the second with its flags run together as a minifier writes.
    const circle: MarkOutline = {
      width: 10,
      height: 10,
      path: 'M0 5a5 5 0 1 0 10 0a5 5 0 10-10 0Z',
    }
    const ink = rasterizeMark(circle, 40, 40)
    expect(inkAt(circle, ink, 40, 5, 5)).toBe(true)
    expect(inkAt(circle, ink, 40, 5, 0.5)).toBe(true)
    expect(inkAt(circle, ink, 40, 0.4, 0.4)).toBe(false)
    expect(inkAt(circle, ink, 40, 9.6, 9.6)).toBe(false)
  })

  it("draws the recovery password's shield: its rim, and the gap inside it", () => {
    const ink = rasterizeMark(RECOVERY_PASSWORD_MARK, 205, 205)
    // Across the shield's left side at mid height: the rim, then the space before the loop.
    expect(inkAt(RECOVERY_PASSWORD_MARK, ink, 205, 1.4, 15)).toBe(true)
    expect(inkAt(RECOVERY_PASSWORD_MARK, ink, 205, 5, 15)).toBe(false)
    // Outside the shield's top corners.
    expect(inkAt(RECOVERY_PASSWORD_MARK, ink, 205, 0.5, 0.5)).toBe(false)
    expect(inkAt(RECOVERY_PASSWORD_MARK, ink, 205, 32.5, 0.5)).toBe(false)
  })
})
