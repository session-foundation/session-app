import { useEffect, useRef, type ReactNode } from 'react'
import { ScrollView, type ScrollViewInstance } from 'react-native'

import { useKeyboardHeight } from './keyboardHeight'

/** Grows to the scroll view's height, so content that does not scroll still fills it. */
const CONTENT = { flexGrow: 1 } as const
const FILL = { flex: 1 } as const

/**
 * A column that scrolls when it is taller than its box, and keeps its end in view above the
 * keyboard -- for one that ends in a field and the action submitting it.
 *
 * An avoiding view around it only shrinks the box to the space above the keyboard; nothing scrolls
 * the content, so a tall column keeps its field and action underneath. So while the keyboard is up
 * this follows each layout of the shrinking box to its end: on iOS the keyboard is reported before
 * anything has shrunk, and following the frames keeps the end against the keyboard as it rises.
 * Android reports the keyboard only once it is up, after the last layout, so that change scrolls
 * too.
 *
 * Taps reach the column's controls with the keyboard up. As the outermost scroll view it claims a
 * touch first, and by default it spends the first tap dismissing the keyboard.
 */
export function EndAboveKeyboardScroll({
  children,
  scrollable,
}: {
  children: ReactNode
  /** Off for content that fits its box, which then neither scrolls nor follows the keyboard. */
  scrollable: boolean
}) {
  const scroller = useRef<ScrollViewInstance>(null)
  const keyboard = useKeyboardHeight()
  const follows = scrollable && keyboard > 0

  useEffect(() => {
    if (!follows) return
    const frame = requestAnimationFrame(() => {
      scroller.current?.scrollToEnd({ animated: true })
    })
    return () => {
      cancelAnimationFrame(frame)
    }
  }, [follows])

  return (
    <ScrollView
      ref={scroller}
      style={FILL}
      contentContainerStyle={CONTENT}
      scrollEnabled={scrollable}
      keyboardShouldPersistTaps="handled"
      onLayout={() => {
        if (follows) scroller.current?.scrollToEnd({ animated: false })
      }}
      // An error appearing under the field pushes the action down, back under the keyboard.
      onContentSizeChange={() => {
        if (follows) scroller.current?.scrollToEnd({ animated: true })
      }}
    >
      {children}
    </ScrollView>
  )
}
