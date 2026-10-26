import { readFileSync, writeFileSync } from 'node:fs'

/**
 * The zoom levels View → Zoom In and Zoom Out step through, and what a picker would list: 10% steps
 * from 50% to 150%, then 175% and 200%. Round numbers read as settings where the browser's own
 * steps (67%, 125%) look arbitrary in a list, and the wider steps at the top keep the largest sizes
 * a couple of presses away. The range is the current desktop client's, 50% to 200%.
 */
export const ZOOM_LEVELS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.75, 2] as const

/** One step in or out, or back to the default. */
export type ZoomStep = 'in' | 'out' | 'reset'

/** The level one step from `current`, which is one of `ZOOM_LEVELS` (see `readZoom`). */
export function steppedZoom(current: number, step: ZoomStep): number {
  if (step === 'reset') return 1
  const found = ZOOM_LEVELS.findIndex((level) => level === current)
  const fromIndex = found === -1 ? ZOOM_LEVELS.indexOf(1) : found
  // Clamped as an index into the levels, so the ends are the first and last level, not 0 and 1.
  const nextIndex = Math.min(
    Math.max(fromIndex + (step === 'in' ? 1 : -1), 0),
    ZOOM_LEVELS.length - 1,
  )
  return ZOOM_LEVELS[nextIndex] ?? 1
}

/** The saved zoom, or the default when there is none or it is not a level this build offers. */
export function readZoom(path: string): number {
  try {
    const saved: unknown = JSON.parse(readFileSync(path, 'utf8'))
    const zoom =
      typeof saved === 'object' && saved !== null && 'zoom' in saved ? saved.zoom : undefined
    return ZOOM_LEVELS.find((level) => level === zoom) ?? 1
  } catch {
    return 1
  }
}

/** Best effort: a zoom that could not be saved comes back at the default next launch. */
export function writeZoom(path: string, zoom: number): void {
  try {
    writeFileSync(path, JSON.stringify({ zoom }))
  } catch {
    // Nothing to tell anybody, and nothing else depends on it.
  }
}

/**
 * How long after a wheel or pinch step the next is ignored. A trackpad or a high-resolution wheel
 * fires many zoom events for one gesture, and each one a step would take a single flick from 100%
 * to the top.
 */
const GESTURE_STEP_INTERVAL_MS = 100

/** How long the zoom waits to be saved after it last changed, so a burst of steps is one write. */
export const ZOOM_SAVE_DELAY_MS = 500

/** Whether a wheel or pinch step at `now` is taken: not within the interval of the last taken. */
export function gestureStepGate(intervalMs = GESTURE_STEP_INTERVAL_MS): (now: number) => boolean {
  let last = Number.NEGATIVE_INFINITY
  return (now) => {
    if (now - last < intervalMs) return false
    last = now
    return true
  }
}
