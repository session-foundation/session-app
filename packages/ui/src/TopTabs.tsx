import { XStack, YStack } from 'tamagui'

import type { FocusRingShape } from './keyboardPress'
import { PressArea } from './PressArea'
import { FitText } from './FitText'
import { LABEL_MAX_SCALE } from './fontScaleCaps'
import type { TopTabsProps } from './TopTabs.types'
import { BAR_HEIGHT, INDICATOR_HEIGHT, INDICATOR_INSET, SLIDE_MS } from './topTabsMetrics'

export type { TopTabsProps }

/** Inside the tab, which shares its edges with its neighbours and the bar's border. */
const TAB_RING: FocusRingShape = { onAccent: false, offset: -2, radius: '$sm' }

/**
 * The bar of tabs across the top of a screen that has more than one way in.
 *
 * The indicator is one bar that moves rather than one per tab appearing and disappearing, which is
 * what the clients draw and what makes the movement read as the selection travelling. Here it is
 * placed as a percentage and moved by a CSS transition; the native flavour measures and animates.
 */
export function TopTabs({ tabs, active, onChange, instant = false }: TopTabsProps) {
  const at = Math.max(
    0,
    tabs.findIndex((tab) => tab.key === active),
  )
  const share = tabs.length === 0 ? 100 : 100 / tabs.length

  // `relative` so the indicator below is placed against this bar. Every react-native view is a
  // containing block and none of this is needed there; on the web a stack is `static` unless it
  // says otherwise, and the indicator's `bottom: 0` then resolves against the page, drawing a
  // green bar across the foot of the window.
  return (
    <YStack
      position="relative"
      height={BAR_HEIGHT}
      borderBottomWidth={1}
      borderBottomColor="$bordersColor"
    >
      <XStack flex={1} alignItems="stretch">
        {tabs.map((tab) => (
          <PressArea
            key={tab.key}
            fill
            ring={TAB_RING}
            {...(tab.testID === undefined ? {} : { testID: tab.testID })}
            accessibilityLabel={tab.label}
            disabled={tab.disabled === true}
            onPress={() => {
              onChange(tab.key)
            }}
          >
            {() => (
              <YStack flex={1} alignItems="center" justifyContent="center">
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
      {/* Two boxes: the outer one is the tab's share of the width and is what moves, the inner
          one is the bar inset within it. A margin on the moving box would be added to its width
          rather than taken out of it, and the indicator would overhang its tab. */}
      <YStack
        position="absolute"
        bottom={0}
        width={`${String(share)}%`}
        // Placed from the leading edge and animated on the same property, so the bar travels the
        // way the tabs are ordered rather than always rightwards. Both have to move together: a
        // transition naming `left` animates nothing when the offset is `inset-inline-start`.
        style={{
          insetInlineStart: `${String(at * share)}%`,
          ...(instant ? {} : { transition: `inset-inline-start ${String(SLIDE_MS)}ms ease-out` }),
        }}
      >
        <YStack
          height={INDICATOR_HEIGHT}
          marginHorizontal={INDICATOR_INSET}
          backgroundColor="$primaryColor"
        />
      </YStack>
    </YStack>
  )
}
