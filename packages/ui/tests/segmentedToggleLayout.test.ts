import { describe, expect, it } from 'vitest'

import {
  SEGMENT_PADDING,
  selectedSegment,
  toggleRowHeight,
  toggleSlop,
} from '#src/segmentedToggleLayout'
import * as web from '#src/segmentedToggleMetrics'
import * as native from '#src/segmentedToggleMetrics.native'

/** The caption line the attachment footer draws the toggle in. */
const FOOTER_HEIGHT = 30

describe('a segmented toggle on touch', () => {
  it('fits the caption line it sits in', () => {
    expect(native.SEGMENT_HEIGHT + 2 * SEGMENT_PADDING).toBeLessThanOrEqual(FOOTER_HEIGHT)
  })

  it('is one target, grown to a thumb’s size on both axes', () => {
    expect(native.SEGMENT_TAPS).toBe('whole')
    const slop = toggleSlop(native.SEGMENT_HEIGHT, native.SEGMENT_TARGET)
    expect(native.SEGMENT_HEIGHT + 2 * SEGMENT_PADDING + 2 * slop).toBeGreaterThanOrEqual(48)
    expect(2 * native.SEGMENT_WIDTH + 3 * SEGMENT_PADDING + 2 * slop).toBeGreaterThanOrEqual(48)
  })

  it('sits in a row tall enough to hold the slop, which stops at the row’s edge', () => {
    const slop = toggleSlop(native.SEGMENT_HEIGHT, native.SEGMENT_TARGET)
    const target = native.SEGMENT_HEIGHT + 2 * SEGMENT_PADDING + 2 * slop
    expect(toggleRowHeight(FOOTER_HEIGHT, native.SEGMENT_TARGET)).toBeGreaterThanOrEqual(target)
  })
})

describe('a segmented toggle with a pointer', () => {
  it('lets each segment be clicked, drawn small', () => {
    expect(web.SEGMENT_TAPS).toBe('segment')
    expect(web.SEGMENT_HEIGHT + 2 * SEGMENT_PADDING).toBeLessThanOrEqual(FOOTER_HEIGHT)
  })

  it('leaves the row it sits in at the caption line’s height', () => {
    expect(toggleRowHeight(FOOTER_HEIGHT, web.SEGMENT_TARGET)).toBe(FOOTER_HEIGHT)
  })
})

describe('the slop that grows the toggle', () => {
  it('is half the shortfall, and nothing where there is none', () => {
    expect(toggleSlop(22, 48)).toBe(11)
    expect(toggleSlop(60, 48)).toBe(0)
  })
})

describe('which segment is selected', () => {
  const segments = [{ value: 'gallery' }, { value: 'list' }] as const

  it('is the one whose value is current', () => {
    expect(selectedSegment(segments, 'gallery')).toBe(0)
    expect(selectedSegment(segments, 'list')).toBe(1)
  })

  it('is neither when the value matches no segment', () => {
    expect(selectedSegment<string>(segments, 'grid')).toBe(-1)
  })
})
