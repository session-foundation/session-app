import { XStack, YStack } from 'tamagui'

import { Icon } from './Icon'
import { logical } from './logicalEdges'
import { PressArea } from './PressArea'
import { RADIUS_SCALE, SIZE_SCALE, SPACE_SCALE } from './scales'
import { Text } from './Text'
import type { ToastCardProps } from './ToastCard.types'
import { useTokenColor } from './useTokenColor'

const WIDTH = 320
const RADIUS = RADIUS_SCALE.sm
const STRIP = 4
const PADDING_BLOCK = SPACE_SCALE.xl
const GLYPH = SIZE_SCALE.xl
const GLYPH_BEFORE = SPACE_SCALE.lg
const GLYPH_AFTER = SPACE_SCALE.md
/** The close cross, in from the top trailing corner, at 70% until the pointer is on it. */
const CLOSE_INSET = SPACE_SCALE.xs
const CLOSE_GLYPH = SIZE_SCALE.sm
const CLOSE_RESTING = 0.7

/**
 * One toast: the same strip and glyph for every message, neither coloured by type. A press
 * anywhere on it dismisses it.
 */
export function ToastCard({ text, onPress, closeLabel, testID, closeTestID }: ToastCardProps) {
  const accent = useTokenColor('$primaryColor')
  const shadow = useTokenColor('$shadow')
  return (
    <XStack
      width={WIDTH}
      maxWidth="100%"
      // The close cross is placed against the toast rather than laid out in it.
      position="relative"
      alignItems="center"
      paddingVertical={PADDING_BLOCK}
      backgroundColor="$backgroundSecondary"
      borderRadius={RADIUS}
      boxShadow={`0px 4px 12px 0px ${shadow}`}
      $platform-web={{ cursor: 'pointer' }}
      userSelect="none"
      pointerEvents="auto"
      role="status"
      onPress={onPress}
      testID={testID}
      {...logical({
        borderStartWidth: STRIP,
        borderStartColor: accent,
        paddingStart: GLYPH_BEFORE,
        // Clear of the cross, so a long message wraps before it.
        paddingEnd: CLOSE_INSET * 2 + CLOSE_GLYPH,
      })}
    >
      <YStack {...logical({ marginEnd: GLYPH_AFTER })}>
        <Icon name="info" size={GLYPH} color="$textPrimary" />
      </YStack>
      <Text flex={1} size="$body">
        {text}
      </Text>
      {/* The whole toast closes on a press; the cross is the control that says so, and the one a
          screen reader names. */}
      <YStack position="absolute" top={0} {...logical({ insetEnd: 0 })}>
        <PressArea accessibilityLabel={closeLabel} testID={closeTestID} onPress={onPress}>
          {() => (
            <YStack padding={CLOSE_INSET} opacity={CLOSE_RESTING} hoverStyle={{ opacity: 1 }}>
              <Icon name="x" size={CLOSE_GLYPH} color="$textPrimary" />
            </YStack>
          )}
        </PressArea>
      </YStack>
    </XStack>
  )
}
