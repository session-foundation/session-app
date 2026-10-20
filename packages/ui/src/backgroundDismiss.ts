/**
 * The responder a screen's background takes so that tapping it puts the keyboard away.
 *
 * **Only while there is a keyboard to put away.** A background that claims every touch holds the
 * gesture for the whole screen, and on Android a list inside it then cannot start a scroll from a
 * slow drag - which is how a thumb starts every scroll. With no keyboard up there is nothing for a
 * tap on the background to do, so it claims nothing and every touch reaches what is under it.
 */
export function backgroundDismissResponder(
  keyboardVisible: () => boolean,
  dismiss: () => void,
): {
  onStartShouldSetResponder: () => boolean
  onResponderRelease: () => void
} {
  return {
    onStartShouldSetResponder: keyboardVisible,
    onResponderRelease: dismiss,
  }
}
