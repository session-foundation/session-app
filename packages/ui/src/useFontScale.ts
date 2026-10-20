import { useSyncExternalStore } from 'react'
import { Dimensions } from 'react-native'

function subscribe(onChange: () => void): () => void {
  const subscription = Dimensions.addEventListener('change', onChange)
  return () => {
    subscription.remove()
  }
}

function readFontScale(): number {
  return Dimensions.get('window').fontScale
}

/**
 * The OS text-size setting: 1 at the default, and always 1 on the web.
 *
 * For a height counted rather than measured, which has to grow with the text it holds. Unlike
 * `useWindowSize`, a resize that leaves the scale alone re-renders nothing.
 */
export function useFontScale(): number {
  return useSyncExternalStore(subscribe, readFontScale, readFontScale)
}
