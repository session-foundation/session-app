import { FONT_SIZE, LINE_HEIGHT_RATIO } from '@session/theme-tokens'

/**
 * How tall a block of `lines` lines is at a given text size.
 *
 * For bounding a *view* rather than the text in it -- a scroll region that shows so many lines and
 * scrolls past that. Counted rather than measured, because a height picked in points cuts the last
 * line in half the moment the type scale or the platform's metrics move, which reads as a
 * rendering fault rather than as something to scroll.
 *
 * Here rather than in whoever needs it because the type scale is `@session/ui`'s to know: nothing
 * outside this package may reach for the tokens.
 *
 * `fontScale` is the OS text-size setting, from `useFontScale`; native text grows with it.
 */
export function textHeight(size: keyof typeof FONT_SIZE, lines: number, fontScale = 1): number {
  return Math.round(FONT_SIZE[size] * LINE_HEIGHT_RATIO * lines * fontScale)
}
