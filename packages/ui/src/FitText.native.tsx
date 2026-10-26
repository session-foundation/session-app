import { MIN_FIT_SCALE } from './fittedFontSize'
import { Text, type TextProps } from './Text'

/**
 * One line of text that shrinks to fit its box, which iOS and Android do themselves, down to half
 * its size as on the web.
 */
export function FitText(props: TextProps) {
  // The one place the prop belongs: this is what everything else is pointed at instead.
  // eslint-disable-next-line no-restricted-syntax
  return <Text numberOfLines={1} {...props} adjustsFontSizeToFit minimumFontScale={MIN_FIT_SCALE} />
}
