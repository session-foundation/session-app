import { flag } from '@session/app'
import { tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'
import {
  Button,
  EndPinnedScroll,
  LABEL_MAX_SCALE,
  MessageBubble,
  Reveal,
  Text,
  useMedia,
  YStack,
} from '@session/ui'
import { useEffect, useState } from 'react'

import { BUBBLE_MIN_WIDTH, bubbleMaxWidth } from './landingBubble'
import { EXTRA_ACTION_INSET, OnboardingChrome } from './OnboardingChrome'
import { TermsAndPrivacy } from './TermsAndPrivacy'

/**
 * The four lines the mobile clients play out as a conversation, in order.
 *
 * The emoji are supplied here because the catalogue does not carry them, as on Android.
 *
 * **A function, not a constant**, because `tr()` reads the locale when it is called. Built once at
 * module scope these would hold whichever language was current when the module was first imported,
 * so the heading would follow the picker and the conversation would not.
 */
function bubbles() {
  return [
    {
      // Keyed by which line it is, not by what it says: the text is translated, so keying on it
      // remounts every bubble when the language changes and replays the conversation from the top.
      key: 'welcome',
      text: tr('onboardingBubbleWelcomeToSession', { emoji: '👋' }),
      outgoing: false,
    },
    { key: 'engineered', text: tr('onboardingBubbleSessionIsEngineered'), outgoing: true },
    { key: 'noPhoneNumber', text: tr('onboardingBubbleNoPhoneNumber'), outgoing: false },
    {
      key: 'easy',
      text: tr('onboardingBubbleCreatingAnAccountIsEasy', { emoji: '👇' }),
      outgoing: true,
    },
  ] as const
}

/** How many lines the conversation has. Fixed, and needed before the strings are built. */
const BUBBLE_COUNT = 4

/**
 * The cadence both mobile clients use: a beat before the first line, then one every second and a
 * half. Android and iOS agree on these to within 300ms, which is close enough to be deliberate.
 */
const FIRST_BUBBLE_MS = 500
const BUBBLE_INTERVAL_MS = 1500

/**
 * The height the conversation is played out in, and why the earlier lines move.
 *
 * The legacy client bottom-aligns the stack inside a box of this fixed height, so each bubble that
 * arrives pushes the ones above it upward. Ours grew downward from a centred stack instead, which
 * is why the conversation read as a list filling in rather than as messages arriving -- the
 * movement is most of the effect, and it belongs to the container rather than to the bubble.
 *
 * The height it takes where there is room. At a large text size there is not, and the box gives
 * way and scrolls rather than pushing the buttons and the terms off the screen: the terms are what
 * creating an account commits somebody to, so they stay in view whatever the text size.
 */
const CONVERSATION_HEIGHT = 320

/** The gap between bubbles. The client's number; the bubble's own metrics are its component's. */
const BUBBLE_GAP = 18

interface LandingScreenProps {
  onCreate: () => void
  onRestore: () => void
}

/**
 * The first screen, and the only one that exists before an identity does.
 *
 * **The two designs share only the buttons and the terms.** The mobile clients open with a heading
 * and a fake conversation that plays itself out; the desktop client has neither -- artwork and the
 * Session lockup come from the frame around it, and the screen itself is two buttons. So "hero"
 * means text on a phone and artwork on a desktop, and this is a fork rather than a reflow.
 */
export function LandingScreen({ onCreate, onRestore }: LandingScreenProps) {
  const wide = useMedia().gtSm

  return (
    // No field on this screen, so nothing here should move for a keyboard -- see the prop.
    <OnboardingChrome testID={ELEMENT.onboarding.screen} avoidsKeyboard={false}>
      {wide ? null : <PhoneOpening />}
      {/* The buttons and the terms sit further in than the text above them on a phone, which is
          what both clients do -- see the insets. The wide design's column is already fixed. */}
      <YStack gap="$sm" {...(wide ? {} : { paddingHorizontal: EXTRA_ACTION_INSET })}>
        <Button
          variant={wide ? 'outline' : 'solid'}
          testID={ELEMENT.onboarding.createAccount}
          onPress={onCreate}
        >
          {tr('onboardingAccountCreate')}
        </Button>
        <Button
          variant={wide ? 'outline' : 'outlineAccent'}
          testID={ELEMENT.onboarding.restoreAccount}
          onPress={onRestore}
        >
          {tr('onboardingAccountExists')}
        </Button>
        <TermsAndPrivacy />
      </YStack>
    </OnboardingChrome>
  )
}

/**
 * The heading and the conversation that plays itself out. Mobile only.
 *
 * The bubble region is the only part that flexes -- the heading takes the height it needs, which is
 * how Android's column is weighted -- and it holds that height from the start, so the buttons below
 * do not walk down the screen while the conversation arrives.
 */
function PhoneOpening() {
  const [shown, setShown] = useState(0)
  /** The conversation's own width, which is what a bubble's share is a share of. */
  const [chatWidth, setChatWidth] = useState(0)

  useEffect(() => {
    if (shown >= BUBBLE_COUNT) return
    const timer = setTimeout(
      () => {
        // No layout animation here: the arriving bubble grows into its own space, which moves the
        // ones above it exactly as far, in the same frame. Asking a layout animation to slide them
        // as well put two animations in charge of one distance and they overlapped.
        setShown((count) => count + 1)
      },
      shown === 0 ? FIRST_BUBBLE_MS : BUBBLE_INTERVAL_MS,
    )
    return () => {
      clearTimeout(timer)
    }
  }, [shown])

  return (
    // Padded at the bottom so a conversation squeezed by a large text size still stands clear of
    // the buttons under it.
    <YStack flex={1} gap="$xl" minHeight={0} paddingBottom="$md">
      <Text
        size="$headingLarge"
        weight="bold"
        textAlign="center"
        maxFontSizeMultiplier={LABEL_MAX_SCALE}
      >
        {tr('onboardingBubblePrivacyInYourPocket')}
      </Text>

      <YStack
        height={CONVERSATION_HEIGHT}
        flexShrink={1}
        minHeight={0}
        overflow="hidden"
        onLayout={(event) => {
          setChatWidth(event.nativeEvent.layout.width)
        }}
      >
        <EndPinnedScroll gap={BUBBLE_GAP}>
          {bubbles()
            .slice(0, shown)
            .map((bubble) => (
              <Reveal key={bubble.key} instant={flag('disableAnimations')}>
                <MessageBubble
                  outgoing={bubble.outgoing}
                  // The conversation shows what Session is like rather than being read for itself.
                  maxFontSizeMultiplier={LABEL_MAX_SCALE}
                  // The floor until the container has been measured, which is one frame and is over
                  // long before the first bubble is due.
                  maxWidth={chatWidth === 0 ? BUBBLE_MIN_WIDTH : bubbleMaxWidth(chatWidth)}
                >
                  {bubble.text}
                </MessageBubble>
              </Reveal>
            ))}
        </EndPinnedScroll>
      </YStack>
    </YStack>
  )
}
