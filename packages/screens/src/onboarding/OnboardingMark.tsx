import { LABEL_MAX_SCALE, SessionBrand, Text } from '@session/ui'

import { NetworkOverlay } from '../NetworkOverlay'

/**
 * The Session mark, stamped with the network it is about to make an account on.
 *
 * Both layouts draw this and neither draws it the same size -- the phone puts it in the bar at
 * the size a navigation title view uses, the wide design sets it beside the wordmark. The stamp
 * is the part that has to agree: it is how somebody tells a mainnet build from anything else, and
 * onboarding is where that matters most, so it belongs to the mark rather than to either layout.
 *
 * `title` swaps the mark for a word, which is what the clients do rather than showing both: the
 * mark *is* the navigation bar's title view, so a screen that wants a title of its own takes the
 * same slot.
 */
export function OnboardingMark({ size, title }: { size: number; title?: string }) {
  return (
    <NetworkOverlay>
      {title === undefined ? (
        <SessionBrand size={size} color="$primaryColor" />
      ) : (
        // One line, so past what fits beside the back control and the language button it
        // truncates rather than running into them.
        <Text
          size="$bodyLarge"
          weight="bold"
          numberOfLines={1}
          maxFontSizeMultiplier={LABEL_MAX_SCALE}
        >
          {title}
        </Text>
      )}
    </NetworkOverlay>
  )
}
