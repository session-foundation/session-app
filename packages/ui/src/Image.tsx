import { Image as RNImage } from 'react-native'

export interface ImageProps {
  /** Where the bytes come from. On both platforms this is the app's media scheme, not a path. */
  uri: string
  width: number
  height: number
  borderRadius?: number
  testID?: string
}

/**
 * A picture, from a URL its platform knows how to resolve.
 *
 * Sized by the caller rather than by the image, because the size is known before the bytes are:
 * an attachment carries the dimensions the sender supplied, and laying the box out from them is
 * what stops a transcript jumping as each picture lands.
 */
export function Image({ uri, width, height, borderRadius, testID }: ImageProps) {
  // react-native's own Image rather than tamagui's: react-native-web turns `source` into an
  // `<img src>`, and tamagui's passes the object straight through as a DOM attribute, which
  // renders an image element with nothing to load. `List` reaches for react-native the same way.
  return (
    <RNImage
      source={{ uri }}
      resizeMode="cover"
      style={{ width, height, ...(borderRadius === undefined ? {} : { borderRadius }) }}
      testID={testID}
    />
  )
}
