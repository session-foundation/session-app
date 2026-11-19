import type { PathSprites } from '@session/ui'
import { requireNativeView } from 'expo'
import type { ViewStyle } from 'react-native'

interface NativeProps {
  spritesJson: string
  pointerEvents: 'none'
  style: ViewStyle
}

const NativePathSprites = requireNativeView<NativeProps>('PathSprites')

/**
 * The path screen's requests run by the platform (`modules/path-sprites`): Core Animation on iOS,
 * one canvas drawing every request on Android. Either way React Native moves no view per frame.
 */
export const mobilePathSprites: PathSprites = ({ sprites, width, height }) => (
  <NativePathSprites
    spritesJson={JSON.stringify(sprites)}
    pointerEvents="none"
    style={{ position: 'absolute', top: 0, left: 0, width, height }}
  />
)
