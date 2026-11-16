import { describe, expect, it } from 'vitest'

import { nearStart } from '#src/listEdges'

const VIEWPORT_PX = 600
const reading = (offsetPx: number, contentPx: number, offsetAtContentPx = contentPx) => ({
  offsetPx,
  viewportPx: VIEWPORT_PX,
  contentPx,
  offsetAtContentPx,
})

describe('nearStart', () => {
  it('is near within the given share of the list’s height from the top', () => {
    expect(nearStart(reading(300, 4000), 0.5)).toBe(true)
    expect(nearStart(reading(301, 4000), 0.5)).toBe(false)
  })

  it('cannot say while the offset is from before rows were added above', () => {
    // At the top of 15 rows; 30 more arrive above and the scroll has not moved past them yet.
    expect(nearStart(reading(20, 3400, 1300), 0.5)).toBeNull()
    // The scroll that moves past them reads against the new height, and says where it is.
    expect(nearStart(reading(2120, 3400), 0.5)).toBe(false)
  })

  it('says near for content no taller than the list, which has no scroll to wait for', () => {
    expect(nearStart(reading(0, 500, 300), 0.5)).toBe(true)
  })
})
