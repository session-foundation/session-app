/**
 * Drawn as small as on the web, so the control fits the caption line it sits in.
 *
 * Two segments at a thumb's size do not fit there, so on touch the whole control is one target
 * that flips the value, grown to `SEGMENT_TARGET` by a slop. With two values, tapping anywhere
 * on it can only mean the other one.
 */
export const SEGMENT_HEIGHT = 22
export const SEGMENT_WIDTH = 28
export const SEGMENT_TAPS: 'segment' | 'whole' = 'whole'
/** Android's 48dp, which also clears Apple's 44pt. */
export const SEGMENT_TARGET = 48
