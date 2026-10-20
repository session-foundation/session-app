import { useEffect, useRef, useState } from 'react'
import { Pressable, type GestureResponderEvent, type PointerEvent } from 'react-native'

import type { PressAreaProps } from './PressArea.types'

export type { PressAreaProps }

/**
 * Pressing the button ends UIKit's hover, and React Native reports that as the pointer leaving --
 * at (0, 0), since an ended hover has no position. Acted on, the control drops to its resting style
 * for a frame before the press styles it. So a leave at (0, 0) is held -- the press that follows
 * replaces the hover style -- and cleared after this long if no press comes, as when the pointer
 * leaves the window. A leave with a position is the pointer moving off, and clears at once.
 */
const HELD_LEAVE_MS = 250

/**
 * After a press whose release position is unknown, how long an enter has to arrive to say the
 * pointer is still over the control.
 */
const AFTER_PRESS_LEAVE_MS = 32

interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * Whether a press ended over the control, as it was when the pointer entered it; undefined when
 * the release has no position. UIKit resumes hover only once the mouse moves again, so a release
 * over the control keeps its hover rather than dropping to rest under a pointer that has not moved.
 */
function releasedOver(e: GestureResponderEvent, r: Rect | undefined): boolean | undefined {
  const { pageX: x, pageY: y } = e.nativeEvent
  if (r === undefined || typeof x !== 'number' || typeof y !== 'number') return undefined
  return x >= r.left && x < r.right && y >= r.top && y < r.bottom
}

/** Whether a leave is UIKit ending the hover -- a click, or the pointer leaving the window. */
function hoverEnded(e: PointerEvent): boolean {
  return e.nativeEvent.clientX === 0 && e.nativeEvent.clientY === 0
}

/**
 * The native half, and the reason this split exists at all.
 *
 * **tamagui's own press does not behave like the platform's.** Its native gesture is a
 * `Gesture.Manual()` whose `onTouchesUp` calls `onPress` unconditionally -- there is no check that
 * the finger is still inside the control. So a touch that starts on a button, slides off it and
 * lifts elsewhere keeps the highlight the whole way and then fires the button, where iOS clears
 * the highlight as the finger leaves and does nothing on release. As it was put in review:
 * *"a behaviour like this is how users can tell something isn't native. But it also feels like a
 * bug"*.
 *
 * `Pressable` is react-native's own implementation of the platform's rules, including the slop a
 * finger is allowed before the press is abandoned, so this hands the gesture to it and reports the
 * state upwards rather than restating those rules.
 */
export function PressArea({
  onPress,
  disabled = false,
  fill = false,
  hitSlop,
  accessibilityLabel,
  role = 'button',
  checked,
  toggled,
  busy = false,
  testID,
  children,
}: PressAreaProps) {
  const [hovered, setHovered] = useState(false)
  const pendingLeave = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pressing = useRef(false)
  const leftDuringPress = useRef(false)
  const hoverRect = useRef<Rect | undefined>(undefined)
  useEffect(() => () => clearTimeout(pendingLeave.current), [])

  const leaveAfter = (delayMs: number) => {
    clearTimeout(pendingLeave.current)
    pendingLeave.current = setTimeout(() => {
      pendingLeave.current = undefined
      setHovered(false)
    }, delayMs)
  }

  return (
    <Pressable
      // The zero basis spelled out: under `flex: 1` alone each label's width leaks into the split,
      // and two fill buttons with different labels come out different widths.
      {...(fill ? { style: { flexGrow: 1, flexShrink: 1, flexBasis: 0 } } : {})}
      accessibilityRole={role}
      disabled={disabled}
      onPress={onPress}
      {...(hitSlop === undefined || hitSlop === 0 ? {} : { hitSlop })}
      accessibilityLabel={accessibilityLabel}
      // Stated whole: passing a state replaces the one Pressable derives from `disabled`. Native
      // has no `pressed` state for a toggle button; both readers announce `selected`.
      accessibilityState={{
        disabled,
        busy,
        ...(checked === undefined ? {} : { checked }),
        ...(toggled === undefined ? {} : { selected: toggled }),
      }}
      testID={testID}
      // A finger reports pointer events too, and it does not hover.
      onPointerEnter={(e: PointerEvent) => {
        if (e.nativeEvent.pointerType === 'touch') return
        clearTimeout(pendingLeave.current)
        pendingLeave.current = undefined
        leftDuringPress.current = false
        const target = e.currentTarget as unknown as { getBoundingClientRect?: () => Rect } | null
        hoverRect.current = target?.getBoundingClientRect?.()
        setHovered(true)
      }}
      onPointerLeave={(e: PointerEvent) => {
        if (e.nativeEvent.pointerType === 'touch') return
        if (pressing.current) leftDuringPress.current = true
        else if (hoverEnded(e)) leaveAfter(HELD_LEAVE_MS)
        else {
          clearTimeout(pendingLeave.current)
          pendingLeave.current = undefined
          setHovered(false)
        }
      }}
      onPressIn={() => {
        pressing.current = true
        if (pendingLeave.current === undefined) return
        clearTimeout(pendingLeave.current)
        pendingLeave.current = undefined
        leftDuringPress.current = true
      }}
      onPressOut={(e) => {
        pressing.current = false
        if (!leftDuringPress.current) return
        leftDuringPress.current = false
        const over = releasedOver(e, hoverRect.current)
        if (over === false) {
          clearTimeout(pendingLeave.current)
          pendingLeave.current = undefined
          setHovered(false)
        } else if (over === undefined) leaveAfter(AFTER_PRESS_LEAVE_MS)
      }}
    >
      {({ pressed }) => children(pressed, hovered && !disabled)}
    </Pressable>
  )
}
