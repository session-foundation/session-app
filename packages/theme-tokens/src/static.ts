// All values are plain numbers (no CSS units) so they work on both web and React Native.

/**
 * One type ramp, named by role in four groups: label, body, header, display.
 *
 * Names rather than positions because a layout has to be readable -- a numbered `size` says nothing
 * about what it is for, and neither does the diff when it changes.
 *
 * **One ramp, one entry per size, ascending.** Names invite a second ramp to be added beside the
 * first and the overlap suffixed, which produces a scale that goes backwards somewhere in the
 * middle and repeats elsewhere -- and nothing catches it, because every name still resolves. A
 * named ramp is fine; a named ramp per source is not.
 *
 * The values are iOS's `Fonts.swift` ramp and Android's typography, which agree with each other and
 * with the newest designs. **iOS has two live ramps**, and this is the newer one: `Values.swift`
 * carries a different scale entirely, so a size read out of iOS means nothing until the file it
 * came from is known.
 *
 * **11 is the floor.** Both mobile clients declare a 9 below it and neither draws anything at it;
 * Desktop's theme records that below 14 is unreadable on that platform.
 */
export const FONT_SIZE = {
  caption: 11,
  label: 12,
  body: 14,
  bodyLarge: 16,
  title: 18,
  titleLarge: 20,
  heading: 23,
  headingLarge: 26,
  display: 29,
  displayMedium: 32,
  displayLarge: 36,
} as const

/**
 * Line height derived rather than declared, at 1.2x the size.
 *
 * Android derives it at exactly this ratio on every entry and is the only place either legacy
 * client derives anything about type; iOS declares no line height at all, anywhere. A ratio also
 * means a size added to the ramp cannot arrive without one.
 */
export const LINE_HEIGHT_RATIO = 1.2

/**
 * Spacing in logical pixels, on a 4 grid.
 *
 * `3xl` 64 is an inset that narrows centred content -- an empty-state label, onboarding's primary
 * button -- rather than a gap between things, which is why there is nothing between it and 36.
 *
 * 32, 48 and 50 are absent on purpose: see THEMING.md for which client each belongs to and why
 * reaching for one should be a decision rather than a lookup.
 */
export const SPACING = {
  '3xl': 64,
  '2xl': 36,
  xl: 24,
  lg: 20,
  md: 16,
  sm: 12,
  xs: 8,
  '2xs': 4,
  '3xs': 2,
} as const

/**
 * Corner radii, on the same 4 grid as the spacing.
 *
 * `md` is a container -- a dialog, a card, an input. `lg` is the message bubble. `xl` is a bottom
 * sheet, on its top two corners only. THEMING.md carries where the ladder comes from, which values
 * are deliberately not rungs, and the nesting rule for a rounded box inside a rounded box.
 */
export const RADII = {
  none: 0,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 28,
  /**
   * The pill. A length rather than `50%`, which resolves per axis and turns a wide control into an
   * ellipse; an oversized length is reduced to half the shorter side, giving a capsule at any
   * width.
   */
  full: 9999,
} as const

/**
 * How far a control fades while a pointer is over it or it is held, where the state is shown by
 * fading rather than by a new fill.
 *
 * Named here so every platform draws the same step: the web reads these through `hoverStyle` and
 * `pressStyle`, and native applies them itself from the same values, so they can only agree.
 */
export const INTERACTION_OPACITY = {
  /** A frameless label under a pointer: it dims, since there is no surface to light. */
  dimHover: 0.7,
  /** The same label held down: a step further than hover, so a click on a hovered label shows. */
  dimPressed: 0.55,
  /** A filled control held down: the fill fades a little toward what is behind it. */
  filledPressed: 0.82,
} as const

// All durations in milliseconds.
export const DURATION = {
  default: 250,
  messageHighlight: 1000,
  typingAnimation: 1600,
  sessionSpinner: 600,
  spinner: 3000,
  pulse: 1000,
  rightPanel: 300,
  progressBar: 500,
  fadein: 1000,
  modalToInbox: 100,
  /**
   * The launch screen fading off the app once it has drawn, on every platform. Short: it softens
   * the cut without making a ready app wait to be seen.
   */
  launchFade: 180,
} as const

// Desktop-specific layout constants - not applicable in React Native.
export const LAYOUT = {
  desktop: {
    leftPanelWidth: 380,
    actionsPanelWidth: 80,
    mainViewHeaderHeight: 68,
    compositionContainerHeight: 60,
    searchInputHeight: 34,
    panelButtonContainerMinHeight: 70,
    userSettingsIconMinWidth: 50,
    rightPanelWidth: 420,
    contactRowHeight: 60,
    contactRowBreakHeight: 20,
  },
} as const
