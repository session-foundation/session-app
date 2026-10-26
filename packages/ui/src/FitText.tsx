import { useLayoutEffect, useRef } from 'react'

import { Text, type TextProps } from './Text'
import { textFitter } from './textFitter'

/**
 * One line of text that shrinks to fit its box rather than truncating, down to half its size on
 * every platform.
 *
 * What `adjustsFontSizeToFit` does on iOS and Android, which react-native-web ignores: there it
 * falls back to an ellipsis, so a line that shrinks on a tablet is cut off on desktop.
 *
 * **The measuring is `textFitter`'s, shared by every line on the page**, so a screen can hold any
 * number of these: they are fitted together, in a pass that lays the page out once or twice,
 * rather than one at a time. The effects here only tell it which lines exist and when one changed,
 * and read nothing themselves.
 */
export function FitText(props: TextProps) {
  const ref = useRef<HTMLElement | null>(null)

  useLayoutEffect(() => {
    const line = ref.current
    if (line === null) return
    return textFitter.watch(line)
  }, [])

  // Again when what it draws changes, and only then: a render that changes neither its text nor
  // its size does nothing.
  useLayoutEffect(() => {
    if (ref.current !== null) textFitter.request(ref.current)
  }, [props.children, props.size, props.maxFontSizeMultiplier])

  // The ref is the DOM node on the web, which is the only platform this file is for.
  // `numberOfLines` before the caller's props: on the web it also sets `maxWidth: 100%`, and the
  // later prop wins, so after them it would undo a caller's own `maxWidth`.
  return <Text ref={ref as never} numberOfLines={1} {...props} />
}
