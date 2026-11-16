import { RADII, SPACING } from '@session/theme-tokens'
import { useEffect, type ReactNode, type RefObject } from 'react'
import { AccessibilityInfo, findNodeHandle } from 'react-native'
import { isWeb, YStack } from 'tamagui'

import { useForcedFocus } from './interactionOverride'
import { focusRing } from './keyboardPress'
import { useListStop } from './listFocus'
import { LandingHighlight } from './LandingHighlight'

/** The frame's inset at each side, so content of a fixed width can be given room for it. */
export const MESSAGE_FRAME_INSET_PX = SPACING.md

/** Outside the bubble, so it shows against the page beside an accent fill as well. */
const RING = focusRing({ onAccent: false, offset: 2, radius: '$lg' })

export interface MessageFrameProps {
  /** Ours, on the accent; otherwise theirs, on the incoming surface. */
  outgoing: boolean
  /** Where it sits in the conversation; unset, it fills what it is given. */
  alignSelf?: 'flex-start' | 'flex-end' | undefined
  maxWidth?: number | `${number}%` | undefined
  /**
   * Changes each time a jump lands on this message, which plays the highlight once more: a ring
   * fading over 1.6 s, or under reduced motion shown and removed. Absent: never landed on.
   */
  highlightSerial?: number | undefined
  /** The highlight at full strength and held, for a picture of a landing. */
  highlightHeld?: boolean | undefined
  /**
   * What VoiceOver and TalkBack are moved to when a jump lands here, which has to be an element
   * of its own, such as the body's text: on a phone the bubble is not one. Unset, they stay put.
   */
  landingFocus?: RefObject<unknown> | undefined
  /**
   * A message the desktop keyboard moves to: its list row's stop, an article to a screen reader,
   * ringed while focused. Desktop only; a phone's reader moves between messages by itself.
   */
  focusable?: boolean | undefined
  testID?: string | undefined
  children: ReactNode
}

/**
 * A conversation message's bubble, holding its body, attachments and send state alike: what
 * `onAccent` and the incoming inks are drawn on. `MessageBubble` is onboarding's text-only one.
 */
export function MessageFrame({
  outgoing,
  alignSelf,
  maxWidth,
  highlightSerial,
  highlightHeld = false,
  landingFocus,
  focusable = false,
  testID,
  children,
}: MessageFrameProps) {
  const stop = useListStop()
  const forcedFocus = useForcedFocus()
  const web = isWeb && focusable

  // A highlight is invisible to VoiceOver and TalkBack, so a landing moves their focus. The
  // desktop's keyboard focus is the list's to move, to this row's stop.
  useEffect(() => {
    if (isWeb || highlightSerial === undefined || landingFocus === undefined) return
    const node = findNodeHandle(landingFocus.current as never)
    if (typeof node === 'number') AccessibilityInfo.setAccessibilityFocus(node)
  }, [highlightSerial, landingFocus])

  return (
    <YStack
      {...(web && stop !== null ? { ref: stop.ref } : {})}
      {...(alignSelf === undefined ? {} : { alignSelf })}
      {...(maxWidth === undefined ? {} : { maxWidth })}
      position="relative"
      backgroundColor={outgoing ? '$primaryColor' : '$messageBubbleIncomingBg'}
      borderRadius="$lg"
      paddingHorizontal={MESSAGE_FRAME_INSET_PX}
      paddingVertical="$sm"
      gap="$2xs"
      {...(web
        ? {
            role: 'article',
            focusVisibleStyle: RING,
            ...forcedFocus,
            ...(stop === null ? {} : { tabIndex: stop.tabIndex }),
          }
        : {})}
      testID={testID}
    >
      {highlightSerial === undefined && !highlightHeld ? null : (
        <LandingHighlight
          serial={highlightSerial}
          still={highlightHeld}
          outgoing={outgoing}
          radiusPx={RADII.lg}
        />
      )}
      {children}
    </YStack>
  )
}
