import type { ReactNode } from 'react'

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
  /** Takes an equal share of the row it is in, so a dialog's actions can share their width. */
  fill?: boolean
  accessibilityLabel?: string
  /**
   * `switch` for a control that flips between two values, announced with `checked` as its state.
   * A button otherwise.
   */
  role?: 'button' | 'switch'
  checked?: boolean
  /**
   * A button that stays on until pressed again, announced as pressed while it is. A segment of a
   * choice drawn as buttons; not the transient press `children` is told about.
   */
  toggled?: boolean
  /** Announced as busy, for a control whose action is running. */
  busy?: boolean
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
