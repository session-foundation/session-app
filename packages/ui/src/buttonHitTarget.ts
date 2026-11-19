import { SIZE_SCALE } from './scales'

/**
 * The smallest a control's touch target is allowed to be.
 *
 * Apple asks for 44 and Android for 48dp; 40 is this app's floor and below both, so it
 * is a minimum rather than a target. It matters most for `xs`, which is drawn at the size of its
 * glyph -- the right look, and a target barely half what a thumb needs. Onboarding's back and
 * language buttons are both that size.
 */
export const MIN_HIT_TARGET = 40

/**
 * The size token each button size is drawn at, which is what `Button`'s own `size` variant sets
 * as its height. Named here rather than measured, so a rung moving on the scale moves the target
 * with it instead of leaving this file quietly disagreeing about how tall a button is.
 */
const SIZE_TOKEN = { xs: 'lg', sm: 'xl', md: '2xl', lg: '3xl' } as const

export type ButtonSize = keyof typeof SIZE_TOKEN

/** How tall a button of this size is drawn, read off the scale its variant names. */
export function buttonHeight(size: ButtonSize): number {
  return SIZE_SCALE[SIZE_TOKEN[size]]
}
