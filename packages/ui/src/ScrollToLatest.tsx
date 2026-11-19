import { XStack } from 'tamagui'

import type { ElementId } from '@session/test-ids'

import { Icon } from './Icon'
import { PressArea } from './PressArea'
import { PRESS_PASSTHROUGH } from './pressPassthrough'
import { StateLayer } from './StateLayer'

export interface ScrollToLatestProps {
  /**
   * A jump has somewhere to return to: the reply glyph joins the arrow, and a press walks back one
   * jump instead of going to the newest message.
   */
  returnsToReply: boolean
  /** Already worded, for what this press does: back to the reply, or to the latest message. */
  accessibilityLabel: string
  onPress: () => void
  testID?: ElementId | undefined
}

/**
 * The transcript's floating button: to the newest message, or back through the jumps a quote made.
 * One control in both states, so it stays where a thumb or the keyboard left it.
 */
export function ScrollToLatest({
  returnsToReply,
  accessibilityLabel,
  onPress,
  testID,
}: ScrollToLatestProps) {
  return (
    // A row, so the press area takes the button's size rather than the width it is given.
    <XStack>
      <PressArea
        onPress={onPress}
        accessibilityLabel={accessibilityLabel}
        ring={{ onAccent: false, offset: 2, radius: '$full' }}
        {...(testID === undefined ? {} : { testID })}
      >
        {(pressed) => (
          <XStack
            {...PRESS_PASSTHROUGH}
            group="control"
            position="relative"
            height="$2xl"
            minWidth="$2xl"
            paddingHorizontal={returnsToReply ? '$xs' : '$none'}
            gap="$2xs"
            alignItems="center"
            justifyContent="center"
            borderRadius="$full"
            borderWidth={1}
            borderColor="$bordersColor"
            backgroundColor="$backgroundSecondary"
            overflow="hidden"
            aria-hidden
            {...{ '$platform-web': { cursor: 'pointer' as const } }}
          >
            <StateLayer group="control" tone="ink" borderRadius="$full" pressed={pressed} />
            {returnsToReply ? <Icon name="reply" size="md" color="$textPrimary" /> : null}
            <Icon name="chevronDown" size="md" color="$textPrimary" />
          </XStack>
        )}
      </PressArea>
    </XStack>
  )
}
