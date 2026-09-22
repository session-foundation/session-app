import { isLayoutRtl } from './layoutDirection'
import type { IconName } from './Icon.types'

/**
 * Which way a back control points.
 *
 * Toward where you came from, which is the leading edge, so it mirrors with the layout. Here
 * rather than beside either back control because both need it and neither owns it -- the app's
 * navigator one and onboarding's step one are different components asking the same question.
 *
 * Asks the layout rather than the language, which matters on native: see `layoutDirection.native`.
 */
export function backChevron(): IconName {
  return isLayoutRtl() ? 'chevronRight' : 'chevronLeft'
}

/**
 * Which way a control pointing onward points: into the row, the sheet or the next step.
 *
 * The other half of the same question, and here for the same reason. Derived from `backChevron`
 * rather than written out, so the pair cannot end up agreeing about only one direction.
 */
export function forwardChevron(): IconName {
  return backChevron() === 'chevronLeft' ? 'chevronRight' : 'chevronLeft'
}
