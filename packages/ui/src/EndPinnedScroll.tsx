import { useRef, type ReactNode } from 'react'
import { ScrollView, type ScrollViewInstance } from 'react-native'

/**
 * Content stacked from the bottom of its box, kept scrolled to the end as it grows, and scrollable
 * back when it outgrows the box.
 *
 * For a run of messages that arrive one at a time: while they fit they sit at the bottom and push
 * the earlier ones up, as a conversation does; once they do not -- a large system text size, a
 * short screen -- the box clips them and the newest stays in view rather than the box growing and
 * pushing what is below it off the screen. The box's size is the caller's to give.
 */
export function EndPinnedScroll({ children, gap }: { children: ReactNode; gap?: number }) {
  const scroller = useRef<ScrollViewInstance>(null)
  return (
    <ScrollView
      ref={scroller}
      style={{ flex: 1 }}
      contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end', gap }}
      showsVerticalScrollIndicator={false}
      onContentSizeChange={() => {
        scroller.current?.scrollToEnd({ animated: false })
      }}
    >
      {children}
    </ScrollView>
  )
}
