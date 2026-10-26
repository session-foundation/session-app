import { describe, expect, it } from 'vitest'

import { pageOffset, settledPage } from '#src/pagerOffset'

describe('placing a page in a paging scroll view', () => {
  it('counts pages from the left, left to right', () => {
    expect(pageOffset(0, 2, 400, false)).toBe(0)
    expect(pageOffset(1, 2, 400, false)).toBe(400)
  })

  it('puts the first page at the right-hand end, right to left', () => {
    expect(pageOffset(0, 2, 400, true)).toBe(400)
    expect(pageOffset(1, 2, 400, true)).toBe(0)
    expect(pageOffset(0, 3, 400, true)).toBe(800)
  })
})

describe('reading the page a scroll has settled on', () => {
  it('names the page under a settled offset in either direction', () => {
    expect(settledPage(400, 2, 400, false)).toBe(1)
    expect(settledPage(400, 2, 400, true)).toBe(0)
    expect(settledPage(0, 2, 400, true)).toBe(1)
  })

  it('agrees with where a page was placed', () => {
    for (const rtl of [false, true]) {
      for (const page of [0, 1, 2]) {
        expect(settledPage(pageOffset(page, 3, 375, rtl), 3, 375, rtl)).toBe(page)
      }
    }
  })

  it('is nothing between two pages, or before the pager has a width', () => {
    expect(settledPage(200, 2, 400, false)).toBeNull()
    expect(settledPage(0, 2, 0, false)).toBeNull()
  })

  it('is no page past either end', () => {
    for (const rtl of [false, true]) {
      expect(settledPage(-400, 2, 400, rtl)).toBeNull()
      expect(settledPage(800, 2, 400, rtl)).toBeNull()
    }
  })

  it('allows the fraction of a pixel a scroll view stops short by', () => {
    expect(settledPage(399.5, 2, 400, false)).toBe(1)
  })
})
