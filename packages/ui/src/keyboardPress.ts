import type { ViewProps } from 'react-native'
import { isWeb } from 'tamagui'

/** Only what the handler reads, so it can take a DOM event or a test's stand-in for one. */
interface PressKeyEvent {
  key: string
  repeat: boolean
  target: unknown
  currentTarget: unknown
  preventDefault: () => void
}

/**
 * Presses on Enter or Space, as a `<button>` does, and only when the focused element is this one:
 * keys bubble, so a stack holding another that takes keys would press for its key too.
 */
/** What a view's `onKeyDown` takes, in react-native's types. */
type KeyDownHandler = NonNullable<ViewProps['onKeyDown']>

function pressOnKey(onPress: () => void): KeyDownHandler {
  return (raw) => {
    // Attached on the web only (see `keyboardPress`), where the event is the DOM's. react-native's
    // types describe its own key event, which carries no `key` or `repeat` at the top.
    const event = raw as unknown as PressKeyEvent
    if (event.target !== event.currentTarget || event.repeat) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    // Space would otherwise scroll whatever the control sits in.
    event.preventDefault()
    onPress()
  }
}

export interface FocusRingShape {
  onAccent: boolean
  offset: number
  radius: number | '$sm' | '$full'
}

/**
 * The ring a keyboard user follows, in the accent: the colour the theme gives tamagui's focus
 * aliases and a focused Input's border. On an accent fill, a bubble you sent, it would vanish.
 *
 * The radius rounds the ring to the shape the control draws, and is set only while focused so
 * nothing changes for a view that is never focused.
 */
export function focusRing({ onAccent, offset, radius }: FocusRingShape) {
  return {
    outlineWidth: 2,
    outlineStyle: 'solid',
    outlineColor: onAccent ? '$onAccent' : '$primaryColor',
    outlineOffset: offset,
    borderRadius: radius,
  } as const
}

/**
 * The tab stop, keys and focus ring of a `<button>`, for a stack with `role="button"`: tamagui
 * hands `onPress` a click and nothing else. Absent where the stack takes no press.
 *
 * Web only. On native a `tabIndex` makes the view one accessibility element, which on iOS would
 * hide whatever is nested in it from VoiceOver.
 */
export function keyboardPress(
  onPress: (() => void) | undefined,
  ring: ReturnType<typeof focusRing>,
) {
  if (!isWeb || onPress === undefined) return {}
  return { tabIndex: 0, onKeyDown: pressOnKey(onPress), focusVisibleStyle: ring }
}

/**
 * A button that is still a tab stop, for a control that cannot act while a transfer runs: a
 * focused element that stops being focusable sends focus to the page. The caller sets
 * `aria-disabled` in every state, since Android keeps a disabled state that is dropped rather than
 * cleared.
 */
export function heldButton(name: string | undefined, ring: ReturnType<typeof focusRing>) {
  return {
    role: 'button',
    ...(name === undefined ? {} : { 'aria-label': name }),
    ...(isWeb ? { tabIndex: 0, focusVisibleStyle: ring } : {}),
  } as const
}
