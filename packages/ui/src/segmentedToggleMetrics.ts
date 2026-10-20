/**
 * How big each segment is drawn. On the web the drawn segment is the target: a pointer is precise,
 * and it is small enough to sit inside a line of caption text.
 *
 * Each segment is its own target here, unlike on touch. Clicking the half you want is direct, and
 * clicking the half already chosen does nothing, where a control that flips would change the
 * view under a click aimed at the one already showing.
 */
export const SEGMENT_HEIGHT = 22
export const SEGMENT_WIDTH = 28
export const SEGMENT_TAPS: 'segment' | 'whole' = 'segment'
/** Nothing to grow to on the web, where the drawn segment is the target. */
export const SEGMENT_TARGET = 0
