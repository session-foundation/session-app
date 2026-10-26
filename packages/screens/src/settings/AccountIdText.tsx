import { ELEMENT } from '@session/test-ids'
import { Text, YStack } from '@session/ui'
import { useState } from 'react'

import { accountIdLines } from './accountIdLines'

/**
 * The ID, one element per line, so the text engine cannot move the breaks -- until the first line
 * no longer fits on one line, at a large system text size or in a narrow window. Then each fixed
 * line would wrap on its own and leave a short run of characters under it, so the ID becomes one
 * text that wraps where the width runs out instead.
 *
 * Which of the two is decided by a hidden copy of the first line, laid out at the full width: its
 * own layout is the only measure of whether it fits, and measuring the copy rather than the line on
 * screen means a change of width or text size never shows the other layout for a frame while it is
 * worked out again. The web reports no text layout and has no system text size, so it keeps the
 * fixed lines.
 */
export function AccountIdText({ sessionId }: { sessionId: string }) {
  const [natural, setNatural] = useState(false)
  const lines = accountIdLines(sessionId)

  return (
    // `relative`: the measuring copy is placed against this box, and on the web a stack is static
    // unless it says so.
    <YStack
      position="relative"
      alignItems="center"
      alignSelf="stretch"
      testID={ELEMENT.settings.accountId}
    >
      <Text
        size="$bodyLarge"
        fontFamily="$mono"
        position="absolute"
        left={0}
        right={0}
        opacity={0}
        pointerEvents="none"
        aria-hidden
        // Spread, because the web's text props do not list it; only the phones report it.
        {...{
          onTextLayout: (event: { nativeEvent: { lines: readonly unknown[] } }) => {
            setNatural(event.nativeEvent.lines.length > 1)
          },
        }}
      >
        {lines[0]}
      </Text>
      {natural ? (
        <Text size="$bodyLarge" fontFamily="$mono" textAlign="center">
          {sessionId}
        </Text>
      ) : (
        lines.map((line, at) => (
          // Keyed by position: lines can repeat (the fake's IDs are runs of zeroes), and duplicate
          // keys crash on iOS.
          <Text key={at} size="$bodyLarge" fontFamily="$mono">
            {line}
          </Text>
        ))
      )}
    </YStack>
  )
}
