import type { ReactNode } from 'react'
import { isWeb, YStack } from 'tamagui'

import { MIN_HIT_TARGET } from './buttonHitTarget'
import { touchReach } from './touchReach'
import { focusRing, type FocusRingShape } from './keyboardPress'
import { PressArea } from './PressArea'
import { PRESS_PASSTHROUGH } from './pressPassthrough'
import { StateLayer } from './StateLayer'

/** Just inside the square, which sits flush with its neighbours down the rail. */
const RING: FocusRingShape = { onAccent: false, offset: -2, radius: '$full' }

export interface RailButtonProps {
  /** The square the control takes, which is its hit area: each rail item names its own. */
  sidePx: number
  /** The control's name, and with no `onPress`, what it reports. */
  accessibilityLabel: string
  /**
   * What a press does. Without one the item is a status rather than a control: still a tab stop
   * on the web, so a keyboard can reach its tooltip, but announced as an image and never lit.
   */
  onPress?: (() => void) | undefined
  testID?: string | undefined
  /** What is drawn at the centre of the square. */
  children: ReactNode
}

/**
 * One item down the side rail: a square hit area with its content centred, lit on hover and press
 * by a round layer the size of the square.
 *
 * Its own component rather than `Button`, whose sizes are control heights: a rail item is a square
 * sized to what it holds. Where one is smaller than a finger needs, a touch reaches past it, which
 * only a tablet's rail ever meets.
 */
export function RailButton({
  sidePx,
  accessibilityLabel,
  onPress,
  testID,
  children,
}: RailButtonProps) {
  const frame = {
    width: sidePx,
    height: sidePx,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  } as const

  if (onPress === undefined)
    return (
      <YStack
        {...frame}
        role="img"
        aria-label={accessibilityLabel}
        {...(isWeb ? { tabIndex: 0, focusVisibleStyle: focusRing(RING) } : {})}
        {...(testID === undefined ? {} : { testID })}
      >
        {children}
      </YStack>
    )

  return (
    <PressArea
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      ring={RING}
      hitSlop={touchReach(sidePx, MIN_HIT_TARGET)}
      {...(testID === undefined ? {} : { testID })}
    >
      {(pressed, hovered) => (
        <YStack
          {...frame}
          group="control"
          $platform-web={{ cursor: 'pointer' }}
          // The `group` would otherwise give the frame tamagui's own press handling on native,
          // which claims the touch before the PressArea round it sees it.
          {...PRESS_PASSTHROUGH}
        >
          <StateLayer
            group="control"
            tone="ink"
            borderRadius="$full"
            pressed={pressed}
            atRest={hovered}
          />
          {children}
        </YStack>
      )}
    </PressArea>
  )
}
