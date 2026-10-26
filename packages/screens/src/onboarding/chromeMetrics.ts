import {
  sessionBrandWidth,
  sessionWordmarkWidth,
  SPACE_SCALE,
  TOP_TABS_HEIGHT,
  useMedia,
} from '@session/ui'
import { useEffect, useState } from 'react'

/**
 * The pixel size both header rings are drawn at.
 *
 * This and the figures below live here rather than in either layout because several have a
 * **different right answer per layout**. A figure that differs by layout is a decision: made once,
 * here, and asked for rather than restated where it is used.
 *
 * One number for both, because `circleHelp` brings its own ring and `IconRing` draws the other.
 * They share a viewBox, so equal boxes make equal circles.
 */
export const RING_SIZE = 22

/**
 * How long the content takes to fade in when a step changes.
 *
 * The desktop client's `--duration-fadein`: long enough to read as a transition rather than a
 * flicker, so the steps feel like one screen changing rather than four replacing each other.
 */
export const FADE_MS = 400

/**
 * Fades from nothing to full whenever `key` changes.
 *
 * Two frames, not an easing curve: the opacity goes to a tamagui stack, which animates it. By
 * hand rather than with a library, because this is the only thing in the app that needs one.
 */
export function useFadeIn(key: string, instant: boolean): number {
  const [shown, setShown] = useState(instant)
  useEffect(() => {
    // The flag exists so an automated run is not racing a transition it cannot see. Nothing to
    // schedule and nothing to undo: the content is simply already there.
    if (instant) return
    setShown(false)
    // Next frame rather than immediately: setting both values in one tick gives no transition to
    // interpolate and the content simply appears.
    const raf = setTimeout(() => {
      setShown(true)
    }, 16)
    return () => {
      clearTimeout(raf)
    }
  }, [key, instant])
  return shown ? 1 : 0
}

/**
 * The height every step's content is given, however short it really is.
 *
 * The desktop client's own number, taken from the tallest step, and its comment says what it is
 * for: *"Min height should match the onboarding step with the largest height -- this prevents the
 * loading spinner from jumping around while still keeping things centered."*
 *
 * **It sits on the column rather than on the step**, which differs from the client: there the
 * reserve is on the back-button wrapper, so the landing screen stands at its own height and the
 * lockup, heading and buttons all move on the way to the next step. Here every screen reserves the
 * same box, so nothing jumps -- at the cost of short screens sitting above the middle rather than
 * on it. That bias is the reserve's own doing: short content top-aligns and the empty part hangs
 * below.
 */
export const CONTENT_MIN_HEIGHT = 276

/**
 * The gap above a wide step's tab bar, tighter than the column's own.
 *
 * The tabs belong to the content under them rather than to the lockup above, and at the column's
 * full gap they read as floating between the two.
 */
export const BANNER_GAP = 12

/**
 * The height a banner adds to a wide step, which is what has to be paid back somewhere.
 *
 * **The column is centred, so its height decides where the lockup sits.** A banner is a sibling of
 * the reserved block, so a step carrying one is this much taller than a step without -- and half
 * of that is how far the centring moves the lockup. `WideChrome` adds the same figure above the
 * column, which puts the top edge back exactly.
 *
 * Asked for rather than written down twice: it is the bar's own height plus the gap above it.
 */
export const BANNER_RESERVE = TOP_TABS_HEIGHT + BANNER_GAP

/**
 * The phone design's two horizontal insets.
 *
 * **Both clients use two, not one**, and agree: the reading column is inset 35 on iOS and 36 on
 * Android, and the primary button 64 on both. The relationship is what is worth porting rather
 * than either number -- **the button is deliberately narrower than the text above it.**
 *
 * 35 is the space scale's `$4`; 64 is written as itself, since inventing a rung for one value
 * would make the scale less useful rather than more.
 */
const HORIZONTAL_CONTENT_INSET = 35

/** The legacy client's navigation-bar mark: `SessionGreen32`, pinned to a 32pt square. */
export const BAR_LOGO_SIZE = 32
const HORIZONTAL_ACTION_INSET = 64

/** What an action needs on top of the content inset it already sits inside. */
export const EXTRA_ACTION_INSET = HORIZONTAL_ACTION_INSET - HORIZONTAL_CONTENT_INSET

/** The room the phone layout leaves around a step. The wide one leaves none -- see below. */
export const STEP_PADDING = {
  paddingHorizontal: HORIZONTAL_CONTENT_INSET,
  paddingTop: '$xl',
  paddingBottom: '$md',
} as const

/**
 * The same padding, for a pane that has to apply it itself.
 *
 * `LoadAccountScreen` turns `padContent` off, because its two panes disagree -- the field belongs
 * in the reading column and the camera fills the width -- and pads the one that wants it. It asks
 * for the figure rather than writing it down: the wide layout adds no horizontal inset at all, its
 * column being `COLUMN_WIDTH` already.
 */
export function useStepPadding(): Partial<typeof STEP_PADDING> {
  return useMedia().gtSm ? {} : STEP_PADDING
}

/**
 * The lockup along the top of the wide frame, in the desktop client's own measurements.
 *
 * Off the ladder deliberately: the mark and the wordmark are artwork sized to line up with each
 * other, not controls whose height is a rung.
 */
export const HEADER_HEIGHT = 30
export const HEADER_MARK_SIZE = 26
export const HEADER_WORDMARK_SIZE = 15

/** Between the mark and the wordmark, the `$xs` the header's row sets. */
export const HEADER_LOCKUP_GAP = SPACE_SCALE.xs

/**
 * The lockup's width at those sizes. The header scales the lockup down from here when the room
 * beside its controls is narrower -- see `OnboardingHeader`.
 */
export const HEADER_LOCKUP_WIDTH =
  sessionBrandWidth(HEADER_MARK_SIZE) +
  HEADER_LOCKUP_GAP +
  sessionWordmarkWidth(HEADER_WORDMARK_SIZE)
