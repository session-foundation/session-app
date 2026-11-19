import { Pressable } from 'react-native'

import type { BubblePressProps } from './BubblePress.types'
import { useMenuLongPress } from './menuLongPress'

/** Whether a press on a whole message bubble acts: a finger needs a target bigger than a word. */
export const BUBBLE_TAKES_PRESS = true

/**
 * A whole message bubble as one touch target, for an action a line of caption text is too small
 * to carry. Not an element of its own to a screen reader, so the bubble's text and controls stay
 * readable one by one; a reader's double tap on any of them lands here. A control inside still
 * takes its own touch, and a long press still opens the message's menu.
 */
export function BubblePress({ onPress, testID, children }: BubblePressProps) {
  const menuLongPress = useMenuLongPress()
  return (
    <Pressable
      accessible={false}
      // Android makes a pressable view a focusable node whatever `accessible` says.
      importantForAccessibility="no"
      onPress={onPress}
      {...menuLongPress}
      testID={testID}
    >
      {children}
    </Pressable>
  )
}
