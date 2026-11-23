import { useEffect, useRef, useState } from 'react'
import { Animated, Easing, type LayoutChangeEvent } from 'react-native'
import { XStack, YStack } from 'tamagui'

import { PressArea } from './PressArea'
import { FitText } from './FitText'
import { LABEL_MAX_SCALE } from './fontScaleCaps'
import { isLayoutRtl } from './layoutDirection'
import type { TopTabsProps } from './TopTabs.types'
import { BAR_HEIGHT, INDICATOR_HEIGHT, INDICATOR_INSET, SLIDE_MS } from './topTabsMetrics'

export type { TopTabsProps }

/**
 * The bar of tabs across the top of a screen that has more than one way in.
 *
 * **One indicator that travels**, rather than one per tab appearing and disappearing: Android
 * slides it across, and the pages slide with it, so the selection reads as moving rather than as
 * being redrawn somewhere else.
 *
 * The width it travels by is measured rather than assumed. A tab's share of the bar depends on how
 * wide the bar is, and on a phone that is the window minus whatever the safe area takes -- not
 * something this can know before it has been laid out.
 */
export function TopTabs({ tabs, active, onChange, instant = false }: TopTabsProps) {
  const [barWidth, setBarWidth] = useState(0)
  const at = Math.max(
    0,
    tabs.findIndex((tab) => tab.key === active),
  )
  const slide = useRef(new Animated.Value(at)).current

  useEffect(() => {
    if (instant) {
      slide.setValue(at)
      return
    }
    const run = Animated.timing(slide, {
      toValue: at,
      duration: SLIDE_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    })
    run.start()
    return () => {
      run.stop()
    }
  }, [at, instant, slide])

  const share = tabs.length === 0 ? 0 : barWidth / tabs.length

  return (
    <YStack
      height={BAR_HEIGHT}
      borderBottomWidth={1}
      borderBottomColor="$bordersColor"
      onLayout={(event: LayoutChangeEvent) => {
        setBarWidth(event.nativeEvent.layout.width)
      }}
    >
      <XStack flex={1} alignItems="stretch">
        {tabs.map((tab) => (
          <PressArea
            key={tab.key}
            fill
            {...(tab.testID === undefined ? {} : { testID: tab.testID })}
            accessibilityLabel={tab.label}
            disabled={tab.disabled === true}
            onPress={() => {
              onChange(tab.key)
            }}
          >
            {() => (
              <YStack flex={1} alignItems="center" justifyContent="center">
                {/* 17 on iOS, bold. The label keeps the text colour in both states: the bar
                    underneath is the whole signal, which is how the client draws it. */}
                <FitText
                  size="$bodyLarge"
                  weight="bold"
                  tone={tab.disabled === true ? 'disabled' : 'primary'}
                  // The tab's width rather than the label's, so a long label has a box to fit.
                  maxWidth="100%"
                  maxFontSizeMultiplier={LABEL_MAX_SCALE}
                >
                  {tab.label}
                </FitText>
              </YStack>
            )}
          </PressArea>
        ))}
      </XStack>
      {/* Nothing to draw until the bar has been measured: an indicator of zero width would show as
          a flash of nothing moving on the first frame. */}
      {share === 0 ? null : (
        <Animated.View
          style={{
            position: 'absolute',
            bottom: 0,
            // The leading edge, which react-native mirrors for us.
            start: INDICATOR_INSET,
            width: share - INDICATOR_INSET * 2,
            height: INDICATOR_HEIGHT,
            transform: [
              {
                // **A transform is not mirrored, and this is the one thing here that is not.**
                // `start` follows the reading direction on its own; `translateX` is pixels along
                // the screen either way, so the bar has to be told to travel the other way when
                // the tabs are ordered the other way.
                translateX: slide.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, isLayoutRtl() ? -share : share],
                }),
              },
            ],
          }}
        >
          <YStack flex={1} backgroundColor="$primaryColor" />
        </Animated.View>
      )}
    </YStack>
  )
}
