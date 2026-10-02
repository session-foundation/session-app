import { useEffect, useState } from 'react'

/**
 * How long the first paint may wait for the account's theme, from launch.
 *
 * Long enough for an ordinary start to read it, so nothing is drawn in a theme that is about to be
 * replaced. Short enough that a slow start still reaches the launch screen, whose own messages
 * only begin seconds later.
 */
export const FIRST_PAINT_HOLD_MS = 1_000

/** When this module was first loaded, which is as close to launch as shared code gets. */
const LAUNCHED_AT_MS = Date.now()

/** How much of the hold is left at `nowMs`, never below zero. */
export function holdRemainingMs(nowMs: number, launchedAtMs: number = LAUNCHED_AT_MS): number {
  return Math.max(0, FIRST_PAINT_HOLD_MS - (nowMs - launchedAtMs))
}

/**
 * Whether to draw yet: once `ready`, or once the hold from launch has run out.
 *
 * Measured from launch rather than from the caller's mount, so a root that holds before its store
 * exists and a provider that holds after share one budget rather than each taking a full one.
 */
export function useFirstPaintHeld(ready: boolean): boolean {
  const [expired, setExpired] = useState(() => holdRemainingMs(Date.now()) === 0)
  useEffect(() => {
    if (ready || expired) return
    const timer = setTimeout(() => {
      setExpired(true)
    }, holdRemainingMs(Date.now()))
    return () => {
      clearTimeout(timer)
    }
  }, [ready, expired])
  return !ready && !expired
}
