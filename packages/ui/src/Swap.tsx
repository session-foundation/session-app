import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Animated, Easing, type LayoutChangeEvent } from 'react-native'

import { useReducedMotion } from './useReducedMotion'

/** About as long as legacy Android's own swap of the same two views. */
const DURATION_MS = 300

/** `Easing.cubic` as a plain function, which the lint will take unbound. */
const cubic = (t: number) => t * t * t

export interface SwapProps {
  /** Names what `children` shows; a new one swaps the old content out for the new. */
  swapKey: string
  children: ReactNode
  /**
   * Swap at once rather than animating. For automated tests, which otherwise photograph whatever
   * is still moving; see the `disableAnimations` flag. The system's reduce-motion setting does the
   * same on its own.
   */
  instant?: boolean | undefined
}

/**
 * One block of content standing in for another: the new one fades in as the box's height moves from
 * the old content's to its own, pushing what is below it along. As legacy Android swaps a recovery
 * password's words for its QR code.
 *
 * **The old content goes at once** rather than fading out over the new. Kept alive beside it, its
 * controls were still in the tree, two of each button, and on the desktop Escape then closed the
 * page under a full-screen code rather than the code.
 *
 * **While it moves, the new content is laid over the box**, pinned to its top, so the box's height
 * is the only thing in flow and the content is uncovered downwards. Its own height is measured on
 * the frame it mounts, before anything moves.
 *
 * **The height a swap starts from is the one the box has**, which is not always one a layout
 * event reported: a box that settles at the height its animation ended on has not changed size,
 * so nothing fires; and a swap that interrupts another starts from wherever that one had reached.
 *
 * **Once it has finished, the content lays out normally** and the box takes whatever height it asks
 * for, so a block that re-wraps later is not clipped to the height it had when it arrived.
 */
export function Swap({ swapKey, children, instant: instantProp = false }: SwapProps) {
  const instant = useReducedMotion() || instantProp
  const [shownKey, setShownKey] = useState(swapKey)
  const [heights, setHeights] = useState<{ from: number; to: number | null } | null>(null)
  const settledHeight = useRef(0)
  const progress = useRef(new Animated.Value(1)).current
  // The animation's current height, read when a swap interrupts it.
  const movingHeight = useRef<number | null>(null)

  if (swapKey !== shownKey) {
    setShownKey(swapKey)
    if (!instant) setHeights({ from: movingHeight.current ?? settledHeight.current, to: null })
  }

  const from = heights?.from ?? 0
  const to = heights?.to ?? null
  useEffect(() => {
    if (to === null) return
    progress.setValue(0)
    const listener = progress.addListener(({ value }) => {
      movingHeight.current = from + (to - from) * value
    })
    const run = Animated.timing(progress, {
      toValue: 1,
      duration: DURATION_MS,
      easing: Easing.inOut(cubic),
      // Height cannot be driven natively, and the height is what moves.
      useNativeDriver: false,
    })
    run.start(({ finished }) => {
      if (!finished) return
      settledHeight.current = to
      movingHeight.current = null
      setHeights(null)
    })
    // Stopped rather than left running: a swap that is itself swapped starts afresh from here.
    return () => {
      run.stop()
      progress.removeListener(listener)
    }
  }, [from, to, progress])

  const measuring = heights !== null && heights.to === null
  // One tree throughout, keyed by what it shows, so the arriving content is not mounted again
  // when the swap ends.
  return (
    <Animated.View
      // As wide as its parent, whatever the parent aligns its children to: while it moves, the
      // content is laid over it, and an absolute child of a box with no width has none either.
      style={
        heights === null
          ? { alignSelf: 'stretch' }
          : {
              alignSelf: 'stretch',
              overflow: 'hidden',
              height:
                heights.to === null
                  ? heights.from
                  : progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [heights.from, heights.to],
                    }),
            }
      }
      onLayout={
        heights === null
          ? (event: LayoutChangeEvent) => {
              settledHeight.current = event.nativeEvent.layout.height
            }
          : undefined
      }
    >
      <Animated.View
        key={shownKey}
        style={
          heights === null
            ? null
            : { position: 'absolute', left: 0, right: 0, top: 0, opacity: measuring ? 0 : progress }
        }
        onLayout={
          measuring
            ? (event: LayoutChangeEvent) => {
                const measured = event.nativeEvent.layout.height
                // Never zero: a view's first pass, before it is laid out, reports nothing.
                if (measured <= 0) return
                setHeights((was) => (was === null ? was : { ...was, to: measured }))
              }
            : undefined
        }
      >
        {children}
      </Animated.View>
    </Animated.View>
  )
}
