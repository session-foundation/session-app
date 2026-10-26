import type { ReactNode } from 'react'

import { YStack } from 'tamagui'

import { Text } from './Text'

/**
 * The bubble's own metrics, which are the legacy clients' numbers rather than scale rungs.
 *
 * A message bubble is drawn to match what the other clients ship, so these are measured values
 * and not positions on the ladder. Named so that the one place they are decided is here.
 */
const BUBBLE_PADDING = 12
const BUBBLE_RADIUS = 13

export interface MessageBubbleProps {
  /** Ours, drawn on the accent; otherwise theirs, on the incoming surface. */
  outgoing?: boolean
  /** The widest it may be, which its container decides -- see `bubbleMaxWidth`. */
  maxWidth?: number
  /**
   * How far the text grows with the system text size, for a bubble that illustrates rather than
   * carries a message: onboarding's conversation. A real message grows with the text size in full.
   */
  maxFontSizeMultiplier?: number | undefined
  children: ReactNode
  testID?: string
}

/**
 * One message, as a bubble.
 *
 * Here rather than beside the screen that first drew one, because the same bubble is what a
 * theme preview shows: a person choosing a theme is choosing what their conversations look like,
 * so the preview has to be the real thing rather than a swatch.
 *
 * The colour pair is the whole of what `outgoing` decides. Both come from the theme, so a bubble
 * restyles with everything else and a preview of a theme is drawn by that theme.
 */
export function MessageBubble({
  outgoing = false,
  maxWidth,
  maxFontSizeMultiplier,
  children,
  testID,
}: MessageBubbleProps) {
  return (
    <YStack
      {...(maxWidth === undefined ? {} : { maxWidth })}
      alignSelf={outgoing ? 'flex-end' : 'flex-start'}
      padding={BUBBLE_PADDING}
      borderRadius={BUBBLE_RADIUS}
      backgroundColor={outgoing ? '$primaryColor' : '$messageBubbleIncomingBg'}
      testID={testID}
    >
      <Text
        size="$bodyLarge"
        color={outgoing ? '$onAccent' : '$messageBubbleIncomingText'}
        maxFontSizeMultiplier={maxFontSizeMultiplier}
      >
        {children}
      </Text>
    </YStack>
  )
}
