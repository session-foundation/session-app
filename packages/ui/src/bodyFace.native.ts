import { Platform } from 'react-native'

import { drawnBodyFace, type Face } from './faceWeights'
import { FONT_ASSETS } from './fontAssets'

/** The face the body font's family resolves to on this platform. See `drawnBodyFace`. */
export const BODY_FACE: Face = drawnBodyFace(Platform.OS, FONT_ASSETS)

/**
 * The family semibold names, where it needs one of its own: Android's.
 *
 * **Android keeps a weight only when no family is named.** Given one, react-native reduces the
 * weight to regular or bold (`ReactFontManager`'s `nearestStyle`: anything under 700 is regular),
 * and the body font names a family, so semibold (Roboto's 500) drew as regular there. Android ships
 * Roboto Medium as `sans-serif-medium`. Named on the variant rather than as the font's `face`:
 * tamagui drops the weight wherever a face supplies the family, which would take bold with it,
 * and Android has no family that is Roboto Bold.
 */
export const SEMIBOLD_FAMILY: string | undefined =
  Platform.OS === 'android' ? 'sans-serif-medium' : undefined
