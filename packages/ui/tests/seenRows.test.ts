import { describe, expect, it } from 'vitest'

import { seenRows } from '#src/seenRows'

describe('seenRows', () => {
  it('counts every row when the last one is whole', () => {
    expect(seenRows({ visible: [4, 5, 6], whole: new Set([5, 6]), atEnd: false })).toEqual([
      4, 5, 6,
    ])
  })

  it('counts a first row cut at its top, since its bottom is showing', () => {
    expect(seenRows({ visible: [4, 5], whole: new Set([5]), atEnd: false })).toEqual([4, 5])
  })

  it('leaves out a last row cut at its bottom', () => {
    expect(seenRows({ visible: [4, 5, 6], whole: new Set([5]), atEnd: false })).toEqual([4, 5])
  })

  it('counts the last row at the end of the list, where nothing can be cut off below it', () => {
    expect(seenRows({ visible: [8, 9], whole: new Set([8]), atEnd: true })).toEqual([8, 9])
  })

  it('leaves out a row taller than the screen until its bottom arrives', () => {
    expect(seenRows({ visible: [3], whole: new Set(), atEnd: false })).toEqual([])
    expect(seenRows({ visible: [3, 4], whole: new Set([4]), atEnd: false })).toEqual([3, 4])
  })

  it('reports rows in index order, whatever order they arrive in', () => {
    expect(seenRows({ visible: [6, 4, 5], whole: new Set([4, 5, 6]), atEnd: false })).toEqual([
      4, 5, 6,
    ])
  })

  it('is nothing when nothing is on screen', () => {
    expect(seenRows({ visible: [], whole: new Set(), atEnd: true })).toEqual([])
  })
})
