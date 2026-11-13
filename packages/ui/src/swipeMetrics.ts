/** Android's distance, which feels right on a phone; iOS's 110 pt is a long way for a thumb. */
export const SWIPE_REPLY_THRESHOLD_PX = 64
/** How much of the travel past the threshold the row still follows. */
export const SWIPE_RESISTANCE = 0.25
/** Sideways travel before the swipe takes the touch, and the vertical travel that gives it up. */
export const SWIPE_ACTIVATE_PX = 10
export const SWIPE_FAIL_Y_PX = 10
/** The way back to rest: critically damped, settled in about a third of a second. */
const SETTLE_RATE_PER_MS = 0.015
const SETTLED_PX = 0.5

/** How far the row is drawn for `toward` px of travel towards the leading edge. */
export function swipeDrawn(toward: number): number {
  const travel = Math.max(0, toward)
  if (travel <= SWIPE_REPLY_THRESHOLD_PX) return travel
  return SWIPE_REPLY_THRESHOLD_PX + (travel - SWIPE_REPLY_THRESHOLD_PX) * SWIPE_RESISTANCE
}

/** One touch on a row, from the finger landing to its letting go. */
export interface SwipeTouch {
  startX: number
  startY: number
  /** A vertical move came first: the touch is the transcript's scroll, whatever follows. */
  gaveUp: boolean
  /** Past the threshold, where letting go replies. */
  armed: boolean
  /** -1 towards the left, 1 towards the right: the leading edge, read as the swipe starts. */
  toward: 1 | -1
}

export function newSwipeTouch(): SwipeTouch {
  return { startX: 0, startY: 0, gaveUp: false, armed: false, toward: -1 }
}

export function startSwipe(touch: SwipeTouch, x: number, y: number): void {
  touch.startX = x
  touch.startY = y
  touch.gaveUp = false
  touch.armed = false
}

/** Whether this move makes the touch a swipe: sideways towards `toward`, before any vertical. */
export function claimsSwipe(touch: SwipeTouch, x: number, y: number, toward: 1 | -1): boolean {
  if (touch.gaveUp) return false
  if (Math.abs(y - touch.startY) > SWIPE_FAIL_Y_PX) {
    touch.gaveUp = true
    return false
  }
  if ((x - touch.startX) * toward <= SWIPE_ACTIVATE_PX) return false
  touch.toward = toward
  return true
}

/** Where the row is drawn for the finger at `x`, and whether this move crossed the threshold. */
export function moveSwipe(touch: SwipeTouch, x: number): { offsetPx: number; tap: boolean } {
  const travel = (x - touch.startX) * touch.toward
  const past = travel >= SWIPE_REPLY_THRESHOLD_PX
  const tap = past && !touch.armed
  touch.armed = past
  return { offsetPx: swipeDrawn(travel) * touch.toward, tap }
}

/** Letting go: whether it replies. */
export function releaseSwipe(touch: SwipeTouch): boolean {
  const replies = touch.armed
  touch.armed = false
  return replies
}

/** The offset `elapsedMs` into the way back from `fromPx`, or null once it is at rest. */
export function settlingOffset(fromPx: number, elapsedMs: number): number | null {
  const t = elapsedMs * SETTLE_RATE_PER_MS
  const offset = fromPx * (1 + t) * Math.exp(-t)
  return Math.abs(offset) < SETTLED_PX ? null : offset
}
