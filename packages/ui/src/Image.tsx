import { Image as RNImage } from 'react-native'

export interface ImageProps {
  /** Where the bytes come from. On both platforms this is the app's media scheme, not a path. */
  uri: string
  width: number
  height: number
  /**
   * How the picture meets the box it was given.
   *
   * `cover` fills it and crops, which is what a square tile of an arbitrary photograph needs.
   * `contain` fits the whole picture inside, which is what showing somebody their picture needs.
   */
  fit?: 'cover' | 'contain'
  borderRadius?: number
  /** Fires when the bytes are decoded and on screen, which is the only honest "it is here". */
  onLoad?: () => void
  testID?: string
}

/**
 * A picture, from a URL its platform knows how to resolve.
 *
 * Sized by the caller rather than by the image, because the size is known before the bytes are:
 * an attachment carries the dimensions the sender supplied, and laying the box out from them is
 * what stops a transcript jumping as each picture lands.
 */
export function Image({
  uri,
  width,
  height,
  fit = 'cover',
  borderRadius,
  onLoad,
  testID,
}: ImageProps) {
  // react-native's own Image rather than tamagui's: react-native-web turns `source` into an
  // `<img src>`, and tamagui's passes the object straight through as a DOM attribute, which
  // renders an image element with nothing to load. `List` reaches for react-native the same way.
  return (
    <RNImage
      source={{ uri }}
      resizeMode={fit}
      style={{ width, height, ...(borderRadius === undefined ? {} : { borderRadius }) }}
      {...(onLoad === undefined ? {} : { onLoad })}
      testID={testID}
    />
  )
}
