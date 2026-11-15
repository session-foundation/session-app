import { useRef, useState } from 'react'
import { type GestureResponderEvent, StyleSheet, View } from 'react-native'

import { useHaptics } from './haptics'
import { isLayoutRtl } from './layoutDirection'
import {
  claimsSwipe,
  moveSwipe,
  newSwipeTouch,
  releaseSwipe,
  settlingOffset,
  startSwipe,
  SWIPE_REPLY_THRESHOLD_PX,
} from './swipeMetrics'
import { SwipeReplyCue } from './SwipeReplyCue'
import type { SwipeToReplyProps } from './SwipeToReply.types'

export type { SwipeToReplyProps }

/**
 * Towards the leading edge, mirrored in RTL: the other way is the back swipe, which from iOS 26
 * starts anywhere on screen. A vertical move first gives the touch up, so the transcript scrolls.
 *
 * Every message row has one, so a row is one plain view until a drag sideways starts on it: the
 * responder props are callbacks, and the cue and the offset exist only while it moves.
 */
export function SwipeToReply({ onReply, enabled = true, children }: SwipeToReplyProps) {
  const haptics = useHaptics()
  const [offset, setOffset] = useState(0)
  const touch = useRef(newSwipeTouch())
  const settling = useRef<number | null>(null)
  // The last move's offset: the state may not have drawn it yet when the finger lifts.
  const drawn = useRef(0)

  const settle = (fromPx: number) => {
    const started = Date.now()
    const step = () => {
      const next = settlingOffset(fromPx, Date.now() - started)
      setOffset(next ?? 0)
      settling.current = next === null ? null : requestAnimationFrame(step)
    }
    settling.current = requestAnimationFrame(step)
  }

  const at = (event: GestureResponderEvent) => event.nativeEvent
  // Unclaimed until it moves sideways, so a press, a long press and a scroll start as they would
  // without it. Capture, so the swipe is taken from a pressable inside the bubble. Attached even
  // when disabled: `enabled` can turn false mid-drag, and the row still has to come back to rest.
  const responder = {
    onTouchStart: (event: GestureResponderEvent) => {
      startSwipe(touch.current, at(event).pageX, at(event).pageY)
    },
    onMoveShouldSetResponderCapture: (event: GestureResponderEvent) =>
      enabled &&
      at(event).touches.length <= 1 &&
      claimsSwipe(touch.current, at(event).pageX, at(event).pageY, isLayoutRtl() ? 1 : -1),
    // True keeps the native scroll view from taking the touch back mid-swipe.
    onResponderGrant: () => {
      if (settling.current !== null) cancelAnimationFrame(settling.current)
      settling.current = null
      return true
    },
    onResponderTerminationRequest: () => false,
    onResponderMove: (event: GestureResponderEvent) => {
      const { offsetPx, tap } = moveSwipe(touch.current, at(event).pageX)
      drawn.current = offsetPx
      setOffset(offsetPx)
      if (tap) haptics?.threshold()
    },
    onResponderRelease: () => {
      if (releaseSwipe(touch.current) && enabled) onReply()
      settle(drawn.current)
    },
    onResponderTerminate: () => {
      releaseSwipe(touch.current)
      settle(drawn.current)
    },
  }

  const progress = Math.min(Math.abs(offset) / SWIPE_REPLY_THRESHOLD_PX, 1)
  return (
    <View
      {...responder}
      {...(offset === 0 ? {} : { style: { transform: [{ translateX: offset }] } })}
    >
      {/* First, so it draws behind the row; held still while the row moves away from it. */}
      {offset === 0 ? null : (
        <View
          style={[
            styles.cue,
            offset < 0 ? styles.cueEnd : styles.cueStart,
            {
              opacity: progress,
              transform: [{ translateX: -offset }, { scale: 0.6 + 0.4 * progress }],
            },
          ]}
        >
          <SwipeReplyCue />
        </View>
      )}
      {children}
    </View>
  )
}

/** Physical edges: the cue sits where the row moves away from, which `offset` already mirrors. */
const styles = StyleSheet.create({
  cue: { position: 'absolute', top: 0, bottom: 0, justifyContent: 'center' },
  cueEnd: { right: 0 },
  cueStart: { left: 0 },
})
