import { Image as RNImage } from 'react-native'

import type { WithTestID } from './with'

export type ImageProps = WithTestID & {
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
  fit?: 'cover' | 'contain' | undefined
  borderRadius?: number | undefined
  /**
   * Android only: Fresco decodes towards the view's pixel size times this, 1 by default. iOS and
   * desktop ignore it.
   */
  resizeMultiplier?: number | undefined
  /** Fires when the bytes are decoded and on screen, which is the only honest "it is here". */
  onLoad?: (() => void) | undefined
  /** Fires when the bytes could not be fetched or decoded. Nothing retries on its own. */
  onError?: (() => void) | undefined
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
  resizeMultiplier,
  onLoad,
  onError,
  testID,
}: ImageProps) {
  // react-native's own Image rather than tamagui's: react-native-web turns `source` into an
  // `<img src>`, and tamagui's passes the object straight through as a DOM attribute, which
  // renders an image element with nothing to load. `List` reaches for react-native the same way.
  return (
    <RNImage
      source={{ uri }}
      resizeMode={fit}
      // Fresco only downsamples towards a target size, and `session-media://` is not one of the
      // local schemes react-native sizes by default: without this the viewer's original decodes at
      // 2048 px, and a file row's glyph decodes a tile-sized thumbnail.
      resizeMethod="resize"
      resizeMultiplier={resizeMultiplier}
      style={{ width, height, borderRadius }}
      onLoad={onLoad}
      onError={onError}
      testID={testID}
    />
  )
}
