import { RADII } from '@session/theme-tokens'

/**
 * The sheet's corner.
 *
 * `xl`, which the radius ladder names as the bottom sheet's: it is the largest rung and the one
 * the scale was written with this in mind. On a phone it is the top two corners only, because
 * there is nothing under the sheet to round away from.
 */
export const SHEET_RADIUS = RADII.xl

/**
 * How much of the window a sheet may take.
 *
 * Short of the whole, deliberately: the page behind stays visible along the top edge, which is
 * what says this is over the conversation rather than a screen the reader navigated to - and it
 * leaves somewhere to tap that is obviously "out".
 */
export const SHEET_MAX_HEIGHT = '80%'

/** As wide as a dialog gets. Wider than the alert, because this holds rows rather than a sentence. */
export const SHEET_MAX_WIDTH = 460

/**
 * How dark the page behind is.
 *
 * The same value the alert uses, and for the same reason: the dimming is what says the page has
 * stopped until this is dealt with.
 */
export const SHEET_SCRIM_OPACITY = 0.6
