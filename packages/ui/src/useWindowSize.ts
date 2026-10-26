import { useWindowDimensions } from 'react-native'

import { usePageZoom } from './pageZoom'

/**
 * The window's size in points, updated as it changes.
 *
 * A thin name over react-native's own hook, which react-native-web implements too, so a layout
 * that has to know its own shape reads the same on both platforms. The media queries answer "is
 * this wide enough for two panes"; this is for the rarer case of needing the number itself --
 * onboarding's artwork, which takes a different share of a portrait window than a landscape one.
 *
 * Reach for `useMedia()` first. A layout that can be expressed as a breakpoint should be, because
 * a breakpoint is declarative and this re-renders on every resize frame.
 */
export function useWindowSize(): { width: number; height: number } {
  const { width, height } = useWindowDimensions()
  // In the page's own units, which the desktop zoom scales: a size laid out inside the page from
  // the window's raw pixels comes out larger than the window by the zoom.
  const zoom = usePageZoom()
  return { width: width / zoom, height: height / zoom }
}
