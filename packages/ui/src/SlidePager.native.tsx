import { useEffect, useRef, useState } from 'react'
import { Keyboard, ScrollView, View, type ScrollViewInstance } from 'react-native'

import { isLayoutRtl } from './layoutDirection'
import { pageOffset, settledPage } from './pagerOffset'
import type { SlidePagerProps } from './SlidePager.types'

export type { SlidePagerProps }

const FILL = { flex: 1 } as const

/**
 * Where the pager is the whole width, its neighbours are off screen anyway, and a page may draw
 * past the pager's box: the camera preview runs under the home indicator.
 */
const UNCLIPPED = { overflow: 'visible' } as const

/**
 * The pages of a tabbed screen, laid side by side and swiped or slid across.
 *
 * **A native paging scroll view, so a swipe moves between the pages.** That is also what settles
 * the swipe against the stack's: from iOS 26 the stack goes back on a swipe from anywhere on the
 * screen, and it waits for a horizontally scrolling view under the finger to decline first. So a
 * swipe towards the previous page goes to it, and only a swipe from the screen's edge -- which
 * always wins -- or one on the first page's leading side leaves the screen.
 *
 * Every page stays mounted. That is what keeps a half-typed recovery phrase there after a look at
 * the other tab: a page taken out of the tree loses everything it was holding.
 */
export function SlidePager({
  index,
  onIndexChange,
  instant = false,
  clip = false,
  children,
}: SlidePagerProps) {
  /**
   * The pager's own width, which is each page's.
   *
   * **Measured rather than read off the window.** The two are the same on a phone, where the pager
   * is the screen, and are not on a tablet, where it is a column inside one.
   */
  const [width, setWidth] = useState(0)
  const scroller = useRef<ScrollViewInstance>(null)
  /** Where the scroll view is, so a page the person swiped to is not scrolled to again. */
  const showing = useRef(index)
  // Whether the keyboard has been dismissed for the move in progress; cleared when a page settles.
  const dismissedThisMove = useRef(false)
  const count = children.length
  const rtl = isLayoutRtl()

  // A tab chosen from the bar: slide to it.
  useEffect(() => {
    if (width === 0 || showing.current === index) return
    showing.current = index
    scroller.current?.scrollTo({ x: pageOffset(index, count, width, rtl), animated: !instant })
    // A new width alone returns above, as the page is already showing; it is placed below.
  }, [index, count, width, rtl, instant])

  // The page showing, placed again at a new width -- the first, or one after a rotation or a
  // resize -- or in a new direction, which mirrors where every page sits. After the pages have
  // been laid out: placed from `onLayout`, the offset is clamped to the old, narrower content and
  // the pager is left between two pages.
  useEffect(() => {
    if (width === 0) return
    scroller.current?.scrollTo({
      x: pageOffset(showing.current, count, width, rtl),
      animated: false,
    })
  }, [count, width, rtl])

  return (
    <ScrollView
      ref={scroller}
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      // Anything a page means to draw outside this box -- the wide back control hangs off the
      // column's leading edge -- belongs to whatever lays the pager out, not inside a page.
      style={[FILL, clip ? null : UNCLIPPED]}
      onLayout={(event) => {
        setWidth(event.nativeEvent.layout.width)
      }}
      // Every scroll rather than the end of a fling: VoiceOver's page swipe moves the view without
      // one, and the tab bar would be left on the old page.
      scrollEventThrottle={16}
      onScroll={(event) => {
        const page = settledPage(event.nativeEvent.contentOffset.x, count, width, rtl)
        // Leaving a page with the keyboard up leaves the field it belongs to. Once the offset has
        // moved, not on `keyboardDismissMode`'s drag: iOS starts a horizontal scroll view's drag on
        // a vertical one too, so scrolling the column it sits in closed the keyboard. Once a move,
        // on its first frame, rather than on every frame until it settles.
        if (page === null) {
          if (!dismissedThisMove.current) Keyboard.dismiss()
          dismissedThisMove.current = true
          return
        }
        dismissedThisMove.current = false
        if (page === showing.current) return
        showing.current = page
        onIndexChange?.(page)
      }}
    >
      {children.map((page, at) => (
        // The pages are a fixed list in source order, so their position is what identifies them.
        <View key={String(at)} style={{ width }}>
          {page}
        </View>
      ))}
    </ScrollView>
  )
}
