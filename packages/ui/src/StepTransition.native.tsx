import { useRef, type ReactNode } from 'react'
import { StyleSheet } from 'react-native'
import { ScreenStack, ScreenStackItem } from 'react-native-screens'

import type { StepTransitionProps } from './StepTransition.types'

export type { StepTransitionProps }

/**
 * The push and pop between onboarding steps, as the platform's own navigation stack draws them.
 *
 * **The flow's reducer is what decides the step**; this mirrors the path back from it into a native
 * stack, so the screen a swipe uncovers is the one back goes to, and a move forward is the
 * platform's push and a move back its pop -- the same curve, the same timing, interruptible, and on
 * iOS with the interactive back swipe. A swipe that completes asks the flow to go back through
 * `onBack`, exactly as the step's own back control does, and the stack then follows the flow like
 * any other move.
 *
 * Every step on the stack stays mounted beneath the one showing, as a native stack keeps them; the
 * one on top always renders `children`, and those below render what they last showed.
 *
 * The phones only: the wide designs cross-fade inside their chrome and never reach this.
 */
export function StepTransition({ path, instant = false, onBack, children }: StepTransitionProps) {
  const shown = useRef(new Map<string, ReactNode>())
  const onTop = path.at(-1)
  if (onTop !== undefined) shown.current.set(onTop, children)

  return (
    <ScreenStack style={styles.fill}>
      {path.map((key) => {
        const top = key === onTop
        return (
          <ScreenStackItem
            key={key}
            screenId={key}
            headerConfig={{ hidden: true }}
            stackAnimation={instant ? 'none' : 'default'}
            gestureEnabled={top && onBack !== undefined}
            onDismissed={() => {
              // The platform has already taken the screen off; the flow catches up, and the
              // stack follows it on the next render.
              onBack?.()
            }}
            contentStyle={styles.fill}
            // **Pinned to the stack's frame.** Left to the item's own `flex: 1`, the stack lays its
            // screens out one under another and only UIKit draws them over each other, so every
            // measurement on a pushed step comes back a screen height too low, and anything placed
            // from one -- the language picker -- opens off the bottom of the screen.
            style={StyleSheet.absoluteFill}
          >
            {top ? children : shown.current.get(key)}
          </ScreenStackItem>
        )
      })}
    </ScreenStack>
  )
}

const styles = StyleSheet.create({ fill: { flex: 1 } })
