import type { ReactNode } from 'react'

import type { FocusRingShape } from './keyboardPress'

/**
 * The props both PressArea variants accept.
 *
 * A third file so neither variant can grow a prop the other lacks. See Screen.types.ts, which is
 * the same arrangement for the same reason.
 */
export interface PressAreaProps {
  onPress?: () => void
  disabled?: boolean
  /** How far outside the control a touch still counts. Native only; a pointer needs no slop. */
  hitSlop?: number
  /**
   * How far the control's own box reaches past what it draws, on each side, given back as margin
   * so nothing round it moves. Native only. Unlike `hitSlop`, it is the box a screen reader and an
   * accessibility audit take for the control's size.
   */
  reach?: number | undefined
  /** Takes an equal share of the row it is in, so a dialog's actions can share their width. */
  fill?: boolean
  accessibilityLabel?: string
  /** Already worded, for what a press does, said after the name. */
  accessibilityHint?: string | undefined
  /**
   * `switch` for a control that flips between two values, announced with `checked` as its state.
   * A button otherwise.
   */
  role?: 'button' | 'switch'
  checked?: boolean
  /**
   * How the keyboard's focus ring is drawn round the control. Web only: the shape is the child's,
   * which only the caller knows. A rounded rectangle just outside the control, on the page.
   */
  ring?: FocusRingShape | undefined
  /** Announced as busy, for a control whose action is running. */
  busy?: boolean
  /**
   * Takes the keyboard's focus when it appears. Web only, for a control that replaces the one just
   * pressed: that one unmounted with the focus, which would otherwise fall back to the page.
   */
  focusOnMount?: boolean | undefined
  testID?: string
  /**
   * The control, told whether it is currently pressed and whether a pointer is over it.
   *
   * A function rather than an element because only the native half knows: on the web the styling
   * is CSS and both are always false.
   *
   * `hovered` is for an iPad's pointer and the iPad app on a Mac. The frame inside a native
   * `PressArea` takes no pointer events -- see `PRESS_PASSTHROUGH` -- and hover is hit-tested like
   * a touch, so the frame's own `hoverStyle` never fires there; the wrapper sees the pointer
   * instead.
   */
  children: (pressed: boolean, hovered: boolean) => ReactNode
}
