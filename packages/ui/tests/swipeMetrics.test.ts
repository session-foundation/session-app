import { describe, expect, it } from 'vitest'

import {
  claimsSwipe,
  moveSwipe,
  newSwipeTouch,
  releaseSwipe,
  settlingOffset,
  startSwipe,
  SWIPE_ACTIVATE_PX,
  SWIPE_FAIL_Y_PX,
  SWIPE_REPLY_THRESHOLD_PX,
  SWIPE_RESISTANCE,
  swipeDrawn,
} from '#src/swipeMetrics'

describe('how far a swiped row is drawn', () => {
  it('follows the thumb up to the threshold', () => {
    expect(swipeDrawn(30)).toBe(30)
    expect(swipeDrawn(SWIPE_REPLY_THRESHOLD_PX)).toBe(SWIPE_REPLY_THRESHOLD_PX)
  })

  it('resists past it, so the threshold is felt', () => {
    expect(swipeDrawn(SWIPE_REPLY_THRESHOLD_PX + 40)).toBe(
      SWIPE_REPLY_THRESHOLD_PX + 40 * SWIPE_RESISTANCE,
    )
  })

  it('does not move the other way, which is the back swipe’s', () => {
    expect(swipeDrawn(-50)).toBe(0)
  })
})

/** A touch landed at (200, 300), the leading edge to the left. */
function landed() {
  const touch = newSwipeTouch()
  startSwipe(touch, 200, 300)
  return touch
}

describe('when a touch on a row becomes a swipe', () => {
  it('once it has moved far enough towards the leading edge', () => {
    const touch = landed()
    expect(claimsSwipe(touch, 200 - SWIPE_ACTIVATE_PX, 300, -1)).toBe(false)
    expect(claimsSwipe(touch, 200 - SWIPE_ACTIVATE_PX - 1, 300, -1)).toBe(true)
  })

  it('never towards the trailing edge, which is the back swipe’s', () => {
    expect(claimsSwipe(landed(), 260, 300, -1)).toBe(false)
  })

  it('mirrored in RTL', () => {
    expect(claimsSwipe(landed(), 220, 300, 1)).toBe(true)
    expect(claimsSwipe(landed(), 180, 300, 1)).toBe(false)
  })

  it('never once a vertical move came first, so the transcript still scrolls', () => {
    // Appium's swipe is a straight line, which never starts vertical and turns.
    const touch = landed()
    expect(claimsSwipe(touch, 198, 300 + SWIPE_FAIL_Y_PX + 1, -1)).toBe(false)
    expect(claimsSwipe(touch, 150, 300, -1)).toBe(false)
  })

  it('afresh on the next touch', () => {
    const touch = landed()
    claimsSwipe(touch, 200, 330, -1)
    startSwipe(touch, 200, 300)
    expect(claimsSwipe(touch, 180, 300, -1)).toBe(true)
  })
})

/** A touch at (200, 300) that a move to the left has made a swipe. */
function swiping() {
  const touch = landed()
  claimsSwipe(touch, 180, 300, -1)
  return touch
}

describe('a swipe', () => {
  it('draws the row towards the leading edge', () => {
    expect(moveSwipe(swiping(), 170).offsetPx).toBe(-30)
  })

  it('taps once as it crosses the threshold, not on every move past it', () => {
    // A haptic is felt, never drawn or read, so no device spec can tell one tap from sixty.
    const touch = swiping()
    const past = 200 - SWIPE_REPLY_THRESHOLD_PX
    expect(moveSwipe(touch, past + 1).tap).toBe(false)
    expect(moveSwipe(touch, past).tap).toBe(true)
    expect(moveSwipe(touch, past - 20).tap).toBe(false)
    expect(moveSwipe(touch, past + 10).tap).toBe(false)
    expect(moveSwipe(touch, past).tap).toBe(true)
  })

  it('replies when let go past the threshold, and not when brought back first', () => {
    const touch = swiping()
    moveSwipe(touch, 200 - SWIPE_REPLY_THRESHOLD_PX)
    expect(releaseSwipe(touch)).toBe(true)

    const back = swiping()
    moveSwipe(back, 200 - SWIPE_REPLY_THRESHOLD_PX)
    moveSwipe(back, 190)
    expect(releaseSwipe(back)).toBe(false)
  })
})

describe('the row’s way back to rest', () => {
  it('starts where it was let go and comes to rest without passing it', () => {
    expect(settlingOffset(-64, 0)).toBe(-64)
    const halfway = settlingOffset(-64, 100)
    expect(halfway).toBeLessThan(0)
    expect(halfway).toBeGreaterThan(-64)
    expect(settlingOffset(-64, 1000)).toBeNull()
  })
})
