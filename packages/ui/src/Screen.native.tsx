import { Keyboard, View } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { YStack } from 'tamagui'

import { backgroundDismissResponder } from './backgroundDismiss'
import type { ScreenProps } from './Screen.types'

export type { ScreenProps }

const ALL_EDGES = ['top', 'bottom', 'left', 'right'] as const

const FILL = { flex: 1 } as const

const DISMISS_ON_BACKGROUND = backgroundDismissResponder(
  () => Keyboard.isVisible(),
  () => {
    Keyboard.dismiss()
  },
)

/**
 * The native flavour: the same frame, held clear of the hardware and of the keyboard.
 *
 * Padding rather than a SafeAreaView, because the inset belongs to the content and not to the
 * background - a list that stops short of the bottom of the display looks like a bug, and one
 * that scrolls its rows under the home indicator does not.
 *
 * Two stacks rather than one so that the inset and the padding add up: the inset is a number of
 * pixels the device reports and the padding is a token, and collapsing them into one prop would
 * mean resolving the token here to do the arithmetic.
 *
 * Read through the hook rather than taken as a prop so a screen never has to know which device
 * it is on. It needs a SafeAreaProvider above it, which the app's root layout installs.
 */
export function Screen({
  children,
  padded = false,
  edges = ALL_EDGES,
  avoidsKeyboard = true,
  testID,
}: ScreenProps) {
  const insets = useSafeAreaInsets()
  const wanted = new Set(edges)

  return (
    <YStack
      flex={1}
      backgroundColor="$backgroundPrimary"
      paddingTop={wanted.has('top') ? insets.top : 0}
      paddingBottom={wanted.has('bottom') ? insets.bottom : 0}
      paddingLeft={wanted.has('left') ? insets.left : 0}
      paddingRight={wanted.has('right') ? insets.right : 0}
      testID={testID}
    >
      {/*
        iOS puts the keyboard over the window without telling the layout, so a composer at the
        bottom of a screen ends up behind it - which is a messenger you cannot type into.

        **react-native-keyboard-controller's, not react-native's.** The platform's own view
        reacts to a JavaScript event after the keyboard has already begun moving and then runs an
        animation of its own, with its own curve and its own duration - so it cannot match, and
        what it looks like is lag. This one is driven by the keyboard's own animation progress,
        `UIKeyboardWillChangeFrame` on iOS and `WindowInsetsAnimation` on Android, as a worklet off
        the JavaScript thread. It also takes `behavior="padding"` on both platforms rather than
        needing the Android exception react-native's did.

        Inside the safe-area padding rather than around it, which is what makes the arithmetic
        come out: the view measures its own bottom edge against the top of the keyboard, and its
        bottom edge is already short by the home indicator.
      */}
      {/*
        Tapping anywhere that is not a control puts the keyboard away, which is the convention on
        both platforms. A bare responder rather than a Touchable: no feedback, no role for a
        screen reader to announce, and no claim at all while the keyboard is down - see
        `backgroundDismissResponder`. A list inside dismisses on its own, `List` says how.

        On the avoiding view itself, never a wrapper: it measures its offset from its parent, and
        a wrapper at the frame's top hides the top inset, leaving the composer under the keyboard.
      */}
      {avoidsKeyboard ? (
        <KeyboardAvoidingView style={FILL} behavior="padding" {...DISMISS_ON_BACKGROUND}>
          <YStack flex={1} {...(padded ? { padding: '$md' } : {})}>
            {children}
          </YStack>
        </KeyboardAvoidingView>
      ) : (
        <View style={FILL} {...DISMISS_ON_BACKGROUND}>
          <YStack flex={1} {...(padded ? { padding: '$md' } : {})}>
            {children}
          </YStack>
        </View>
      )}
    </YStack>
  )
}
