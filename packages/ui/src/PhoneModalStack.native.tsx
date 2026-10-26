import type { ReactNode } from 'react'
import { FONT_SIZE } from '@session/theme-tokens'
import { Platform, StyleSheet } from 'react-native'
import { ScreenStack, ScreenStackHeaderLeftView, ScreenStackItem } from 'react-native-screens'
import { ScrollView, XStack, YStack } from 'tamagui'

import { BarButton } from './BarButton'
import { Icon } from './Icon'
import { ACTION_HEIGHT } from './modalPanelMetrics'
import { SPACE_SCALE } from './scales'
import { PressArea } from './PressArea'
import { useScreenInsets } from './screenInsets'
import { Text } from './Text'
import { useTokenColor } from './useTokenColor'

/** iOS 26's bars draw a glass button around a leading item; earlier iOS and Android do not. */
const BAR_DRAWS_BUTTON =
  Platform.OS === 'ios' && Number.parseInt(String(Platform.Version), 10) >= 26

/** Lines the Android title up with where the bar places a pushed screen's title. */
const TITLE_AFTER_CLOSE = SPACE_SCALE.lg

const styles = StyleSheet.create({ fill: { flex: 1 } })

/** One screen of the modal, as the phone's stack draws it. */
interface PhoneModalScreen {
  key: string
  title: string
  render: () => ReactNode
  footer?: (() => ReactNode) | undefined
}

export interface PhoneModalStackProps {
  /** Oldest first: the first is the modal's own screen, the rest were pushed onto it. */
  screens: readonly PhoneModalScreen[]
  /** Names the close control on the first screen. */
  closeLabel: string
  /** Closes the modal from its first screen, or undefined where it cannot be left that way. */
  onClose?: (() => void) | undefined
  /**
   * The platform dismissed the screen with this key (back swipe, back button); the stack must
   * follow. Also reported for a screen JS removed itself, which the stack ignores by key.
   */
  onPop: (key: string) => void
  closeTestID?: string | undefined
  /**
   * On each screen's content. Back is the platform's own control, so it carries no id of ours: a
   * test reaches it through the system's back.
   */
  testID?: string | undefined
}

/**
 * A modal's screens on a phone, on the platform's native stack and bar. `screens` stays the source
 * of truth: screens the platform removes (back swipe, back button) are reported through `onPop`.
 */
export function PhoneModalStack({
  screens,
  closeLabel,
  onClose,
  onPop,
  closeTestID,
  testID,
}: PhoneModalStackProps) {
  const background = useTokenColor('$backgroundPrimary')
  const text = useTokenColor('$textPrimary')
  // The modal runs under the home indicator; the last thing on a screen is held clear of it.
  const bottom = useScreenInsets().bottom

  return (
    <ScreenStack style={styles.fill}>
      {screens.map((screen, at) => (
        <ScreenStackItem
          key={screen.key}
          screenId={screen.key}
          gestureEnabled={at > 0}
          onDismissed={() => {
            onPop(screen.key)
          }}
          contentStyle={[styles.fill, { backgroundColor: background }]}
          // Pinned to the stack's frame, as onboarding's steps are: left to the item's own
          // `flex: 1`, a pushed screen measures a screen height lower than it is drawn.
          style={StyleSheet.absoluteFill}
          headerConfig={{
            title: screen.title,
            titleFontSize: FONT_SIZE.headingLarge,
            titleFontWeight: '700',
            backgroundColor: background,
            color: text,
            titleColor: text,
            hideShadow: true,
            backTitleVisible: false,
            // One step at a time: the long-press menu would take several screens off at once.
            disableBackButtonMenu: true,
            children:
              at === 0 && onClose !== undefined ? (
                <ScreenStackHeaderLeftView>
                  {BAR_DRAWS_BUTTON ? (
                    // A bare glyph: the bar draws the glass button, so a pressed state of ours
                    // would read as two buttons.
                    <PressArea
                      accessibilityLabel={closeLabel}
                      onPress={onClose}
                      {...(closeTestID === undefined ? {} : { testID: closeTestID })}
                    >
                      {() => <Icon name="x" size="lg" color="$textPrimary" />}
                    </PressArea>
                  ) : (
                    <XStack alignItems="center" gap={TITLE_AFTER_CLOSE}>
                      <BarButton
                        icon="x"
                        accessibilityLabel={closeLabel}
                        onPress={onClose}
                        testID={closeTestID}
                      />
                      {/* Android's bar drops its title once there is a leading item. */}
                      {Platform.OS === 'android' ? (
                        <Text size="$headingLarge" weight="bold" numberOfLines={1}>
                          {screen.title}
                        </Text>
                      ) : null}
                    </XStack>
                  )}
                </ScreenStackHeaderLeftView>
              ) : undefined,
          }}
        >
          <ScrollView
            flex={1}
            {...(testID === undefined ? {} : { testID })}
            {...(screen.footer === undefined
              ? { contentContainerStyle: { paddingBottom: bottom } }
              : {})}
          >
            {screen.render()}
          </ScrollView>
          {screen.footer === undefined ? null : (
            <YStack paddingBottom={bottom}>
              <XStack alignItems="stretch" height={ACTION_HEIGHT}>
                {screen.footer()}
              </XStack>
            </YStack>
          )}
        </ScreenStackItem>
      ))}
    </ScreenStack>
  )
}
