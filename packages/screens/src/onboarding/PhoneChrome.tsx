import { Screen, SPACE_SCALE, XStack, YStack } from '@session/ui'
import { useState } from 'react'

import { BACK_WIDTH, OnboardingBackButton } from './OnboardingBackButton'
import { LanguageButton } from '../LanguageButton'
import { OnboardingMark } from './OnboardingMark'
import { BAR_LOGO_SIZE, STEP_PADDING } from './chromeMetrics'
import type { ChromeProps } from './chromeProps'

/**
 * Onboarding as a phone draws it: a bar, then the step filling the screen.
 *
 * No artwork and no lockup -- the mark lives in the bar, as the mobile clients' navigation title
 * view. Its own file rather than a branch inside the chrome because it and `WideChrome` are two
 * designs rather than one design with options: nearly nothing in the markup lines up between
 * them, and reading either while the other is interleaved with it is how a figure meant for one
 * ended up in the other.
 */
export function PhoneChrome({
  children,
  testID,
  onBack,
  backDisabled = false,
  barTitle,
  banner,
  padContent = true,
  avoidsKeyboard = true,
}: ChromeProps) {
  /** The language button's width, which varies with the flag; the back control's is fixed. */
  const [languageWidth, setLanguageWidth] = useState(0)
  // The bar's own padding, then the control.
  const sideInset = SPACE_SCALE.md + Math.max(BACK_WIDTH, languageWidth)
  return (
    // Not `padded`: onboarding has its own inset, which is more than twice the screen default
    // and is the clients' own. See the constants.
    <Screen testID={testID} avoidsKeyboard={avoidsKeyboard}>
      {/* The bar the phone design puts above the step. Its controls sit in from the edge by the
            space the platform's own navigation bar uses, not by the hairline the content inset
            would leave them. */}
      {/* `relative`: the centred mark below is placed against this bar, and on the web a
            stack is `static` unless it says so. See TopTabs. */}
      <XStack
        position="relative"
        alignItems="center"
        minHeight="$2xl"
        paddingHorizontal="$md"
        paddingTop="$xs"
      >
        {onBack === undefined ? null : (
          <OnboardingBackButton onPress={onBack} disabled={backDisabled} />
        )}
        <YStack flex={1} />
        {/* **The Session mark, centred in the bar.** The legacy client puts it there as the
              navigation bar's `titleView` -- the brand mark alone at 32pt, no wordmark -- which is
              why it looked absent here: there is nothing to add to the screen's body, it belongs
              to the chrome. Absolutely positioned so it is centred on the *bar* rather than on
              whatever space the two controls leave, which is what a title view does. */}
        {/* Inset by the wider of the two controls on both sides, so it stays centred and a long
            title truncates before it reaches either of them rather than drawing under them. */}
        <YStack
          position="absolute"
          left={sideInset}
          right={sideInset}
          alignItems="center"
          pointerEvents="none"
        >
          <OnboardingMark
            size={BAR_LOGO_SIZE}
            {...(barTitle === undefined ? {} : { title: barTitle })}
          />
        </YStack>
        <YStack
          onLayout={(event) => {
            setLanguageWidth(event.nativeEvent.layout.width)
          }}
        >
          <LanguageButton />
        </YStack>
      </XStack>
      {/* `flex` is load-bearing. Without it this box takes its content's height, and a child
            asking for `flex: 1` inside it resolves against nothing and collapses to zero -- which
            drew the landing screen's heading and its conversation straight over the buttons
            underneath. The step is what fills the phone screen, so the box holding it has to. */}
      {/* The bar and the title were almost touching. The client leaves a navigation bar's worth
            of air under the logo before the content begins. */}
      {banner}
      <YStack flex={1} {...(padContent ? STEP_PADDING : {})}>
        {children}
      </YStack>
    </Screen>
  )
}
