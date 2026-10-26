import { YStack } from 'tamagui'

import { focusRing, keyboardPress, type FocusRingShape } from './keyboardPress'
import type { PressAreaProps } from './PressArea.types'

export type { PressAreaProps }

const PAGE_RING: FocusRingShape = { onAccent: false, offset: 2, radius: '$sm' }

/**
 * The web half: tamagui handles the press and the styling, so there is nothing to track.
 *
 * `pressed` is always false here and the frame inside styles itself through `pressStyle`, which is
 * a CSS pseudo-class on the web and needs no state. See PressArea.native.tsx, where it does not.
 *
 * **A column, because the native half is one.** This split is about the press gesture and nothing
 * else, so the two halves have to lay their child out identically -- and the native half wraps it
 * in a `Pressable`, which is a view, which stacks down the page and stretches its children across.
 * A row stretches the other axis instead and leaves the frame inside sized to its own content, so
 * a button draws to the width of its label rather than the width it was given, and a label too
 * long for that width overflows instead of wrapping.
 *
 * It is the tab stop, as `Pressable` is the accessibility element on native: tamagui turns
 * `onPress` into a click and nothing else.
 */
export function PressArea({
  onPress,
  disabled = false,
  fill = false,
  accessibilityLabel,
  role = 'button',
  checked,
  ring = PAGE_RING,
  busy = false,
  testID,
  children,
}: PressAreaProps) {
  const press = disabled ? undefined : onPress
  return (
    <YStack
      {...(fill ? { flex: 1 } : {})}
      role={role}
      {...(checked === undefined ? {} : { 'aria-checked': checked })}
      // A control's label is not selectable text; set here so a new control cannot forget it.
      userSelect="none"
      disabled={disabled}
      onPress={press}
      {...keyboardPress(press, focusRing(ring))}
      aria-label={accessibilityLabel}
      aria-busy={busy}
      testID={testID}
    >
      {children(false, false)}
    </YStack>
  )
}
