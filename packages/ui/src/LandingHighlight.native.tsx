import { ELEMENT } from '@session/test-ids'
import { useEffect, useRef } from 'react'
import { AccessibilityInfo, Animated } from 'react-native'

import {
  LANDING_ALPHA,
  LANDING_FADE_MS,
  LANDING_GLOW_PX,
  LANDING_GLOW_SPREAD_PX,
  LANDING_RING_PX,
} from './landingMetrics'
import type { LandingHighlightProps } from './LandingHighlight.types'
import { useTokenColor } from './useTokenColor'

/** One fade on the native driver, or under reduced motion shown and then removed. */
export function LandingHighlight({
  serial,
  still = false,
  outgoing,
  radiusPx,
}: LandingHighlightProps) {
  const ring = useTokenColor(outgoing ? '$textPrimary' : '$primaryColor')
  const opacity = useRef(new Animated.Value(still ? 1 : 0)).current

  useEffect(() => {
    if (still) {
      opacity.setValue(1)
      return
    }
    if (serial === undefined) return
    opacity.setValue(1)
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let fade: Animated.CompositeAnimation | undefined
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (!live) return
      if (reduced) timer = setTimeout(() => opacity.setValue(0), LANDING_FADE_MS)
      else {
        fade = Animated.timing(opacity, {
          toValue: 0,
          duration: LANDING_FADE_MS,
          useNativeDriver: true,
        })
        fade.start()
      }
    })
    return () => {
      live = false
      clearTimeout(timer)
      fade?.stop()
    }
  }, [serial, still, opacity])

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={ELEMENT.conversation.messageHighlight}
      style={{
        position: 'absolute',
        top: -LANDING_RING_PX,
        bottom: -LANDING_RING_PX,
        left: -LANDING_RING_PX,
        right: -LANDING_RING_PX,
        opacity,
      }}
    >
      <Animated.View
        style={{
          flex: 1,
          borderRadius: radiusPx + LANDING_RING_PX,
          borderWidth: LANDING_RING_PX,
          borderColor: ring,
          opacity: LANDING_ALPHA,
          boxShadow: `0px 0px ${String(LANDING_GLOW_PX)}px ${String(LANDING_GLOW_SPREAD_PX)}px ${ring}`,
        }}
      />
    </Animated.View>
  )
}
