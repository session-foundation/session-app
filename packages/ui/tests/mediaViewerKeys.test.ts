import { describe, expect, it } from 'vitest'

import { mediaViewerKeyIndex } from '#src/mediaViewerKeys'

describe('the arrow keys in a left-to-right layout', () => {
  const at = (index: number) => ({ index, count: 3, rtl: false })

  it('steps forward on ArrowRight and back on ArrowLeft', () => {
    expect(mediaViewerKeyIndex('ArrowRight', at(1))).toBe(2)
    expect(mediaViewerKeyIndex('ArrowLeft', at(1))).toBe(0)
  })

  it('stops at the ends rather than wrapping', () => {
    expect(mediaViewerKeyIndex('ArrowLeft', at(0))).toBeNull()
    expect(mediaViewerKeyIndex('ArrowRight', at(2))).toBeNull()
  })

  it('leaves every other key alone', () => {
    expect(mediaViewerKeyIndex('ArrowUp', at(1))).toBeNull()
    expect(mediaViewerKeyIndex('Enter', at(1))).toBeNull()
  })
})

describe('the arrow keys in a right-to-left layout', () => {
  it('follow the mirrored chevrons: ArrowLeft steps forward', () => {
    expect(mediaViewerKeyIndex('ArrowLeft', { index: 1, count: 3, rtl: true })).toBe(2)
    expect(mediaViewerKeyIndex('ArrowRight', { index: 1, count: 3, rtl: true })).toBe(0)
  })
})
