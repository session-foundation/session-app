import { tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'
import { logical, backChevron, BarButton, SIZE_SCALE, SPACE_SCALE, YStack } from '@session/ui'

/**
 * The way back out of an onboarding step, drawn in four places.
 *
 * A bar button, so on iOS 26 it sits on glass like the system's own back, and elsewhere is the
 * desktop's circle. Told what back means because onboarding's steps are not routes.
 */
export function OnboardingBackButton({
  onPress,
  disabled = false,
}: {
  onPress: () => void
  disabled?: boolean
}) {
  return (
    <BarButton
      icon={backChevron()}
      accessibilityLabel={tr('back')}
      testID={ELEMENT.onboarding.back}
      onPress={onPress}
      disabled={disabled}
    />
  )
}

/** The control's width: a `md` circular bar button's. */
export const BACK_WIDTH = SIZE_SCALE['2xl']

/** Clears the heading with the whole circle, which iOS 26's glass makes visible. */
const BACK_GAP = SPACE_SCALE.xs

/** Where the heading starts, from the column's edge. */
const HEADING_INSET = SPACE_SCALE['2xs']

/**
 * How far the wide control hangs past the column's leading edge. Whatever holds the column keeps
 * at least this much room beside it, or a scrolling container clips the control.
 */
export const WIDE_BACK_OVERHANG = BACK_WIDTH + BACK_GAP - HEADING_INSET

/**
 * The same control, hung off the side of the wide column.
 *
 * The fixed height pins it to the heading's first line, so it stays level however many lines the
 * title wraps to.
 */
export function WideBackButton({
  onPress,
  disabled = false,
}: {
  onPress: () => void
  disabled?: boolean
}) {
  return (
    <YStack
      // Negative, because the control hangs outside the fixed-width column. The end margin is the
      // gap, so the heading stays put however far out the control hangs.
      {...logical({ marginStart: HEADING_INSET - BACK_WIDTH - BACK_GAP, marginEnd: BACK_GAP })}
      height="$xl"
      justifyContent="center"
    >
      <OnboardingBackButton onPress={onPress} disabled={disabled} />
    </YStack>
  )
}
