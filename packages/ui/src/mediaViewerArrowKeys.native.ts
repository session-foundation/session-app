import type { MediaViewerArrowKeysOptions } from './mediaViewerArrowKeys.types'

/**
 * Nothing on a phone or tablet: react-native reports no hardware key presses outside a focused
 * text input, so an iPad's keyboard cannot reach the viewer. See the desktop version.
 */
export function useMediaViewerArrowKeys(_options: MediaViewerArrowKeysOptions): void {
  // No key events to listen for.
}
