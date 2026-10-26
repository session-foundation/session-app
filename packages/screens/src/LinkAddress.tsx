import { tr } from '@session/localization'
import { LABEL_MAX_SCALE, ScrollView, textHeight, useCappedFontScale } from '@session/ui'

import { LocalizedText } from './LocalizedText'

/**
 * How much of the question and the address is shown before it scrolls.
 *
 * **Lines rather than a pixel height**, so the last one is never cut in half -- which reads as a
 * rendering fault rather than as something to scroll.
 *
 * The address is bounded by the view and never truncated: what a long URL loses to an ellipsis is
 * its end, and the end is where a deceptive one hides what it really is.
 */
const MAX_LINES = 5
const MAX_URL_HEIGHT = textHeight('body', MAX_LINES)

/**
 * The question a link confirmation asks, with the address in it, for both places that ask.
 *
 * The text grows like a label's, to twice the default and no further: past that a long address
 * wraps a few letters to a line. The box grows with it, or it would show fewer than its lines.
 * Nested scrolling on, because the dialog's own body scrolls too when it overflows, and Android
 * otherwise gives every drag to the outer one.
 */
export function LinkAddress({ url }: { url: string }) {
  const textScale = useCappedFontScale(LABEL_MAX_SCALE)
  return (
    <ScrollView maxHeight={MAX_URL_HEIGHT * textScale} nestedScrollEnabled>
      {/* The catalogue string carries the address in a bold run and two line breaks before it,
          so the question and the URL are one piece of copy rather than two stacked elements. */}
      <LocalizedText
        text={tr('urlOpenDescription', { url })}
        size="$body"
        textAlign="center"
        maxFontSizeMultiplier={LABEL_MAX_SCALE}
      />
    </ScrollView>
  )
}
