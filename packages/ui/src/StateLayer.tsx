import type { GroupNames } from 'tamagui'
import { YStack } from 'tamagui'

import { TILE_HOVER_OPACITY, TILE_PRESS_OPACITY, TILE_SCRIM } from './attachmentTileStyle'
import { FEEDBACK_TRANSITION } from './feedbackTransition'

/**
 * `ink` is the text colour, so it shows on any surface in either theme; `scrim` is the fixed
 * black a photograph needs, whatever the theme.
 */
const TONES = {
  ink: { color: '$textPrimary', hover: 0.12, press: 0.2 },
  scrim: { color: TILE_SCRIM, hover: TILE_HOVER_OPACITY, press: TILE_PRESS_OPACITY },
} as const

/**
 * The hover and press feedback of a control, drawn over it by the nearest ancestor with this
 * `group` name. That ancestor needs `position="relative"`.
 *
 * A layer rather than a style on the control, so the control's own colours and its clipping view
 * stay as they are.
 */
export function StateLayer({
  group,
  tone,
  borderRadius,
  bleed = 0,
  atRest = false,
  pressed = false,
}: {
  group: GroupNames
  tone: keyof typeof TONES
  borderRadius?: number | '$sm' | '$full' | undefined
  /** How far past the group's sides to draw, for a row whose content runs to its edges. */
  bleed?: number | undefined
  /** Drawn at the hover strength without a pointer, for touch, where nothing hovers. */
  atRest?: boolean | undefined
  /** Drawn at the press strength, for a control whose touch is handled above the group's view. */
  pressed?: boolean | undefined
}) {
  const { color, hover, press } = TONES[tone]
  return (
    <YStack
      position="absolute"
      top={0}
      bottom={0}
      left={-bleed}
      right={-bleed}
      {...(borderRadius === undefined ? {} : { borderRadius })}
      backgroundColor={color}
      opacity={pressed ? press : atRest ? hover : 0}
      pointerEvents="none"
      style={FEEDBACK_TRANSITION}
      {...{
        [`$group-${group}-hover`]: { opacity: hover },
        [`$group-${group}-press`]: { opacity: press },
      }}
    />
  )
}
