import { useCallback, useRef } from 'react'

import { ANIMATED_SCROLL_MS, ROW_FRAMES, useIndexTarget } from './indexTarget'
import type { RowScroller, RowScrollerInput, ScrollToRow } from './rowScroller.types'

interface WebBox {
  getBoundingClientRect: () => { top: number; bottom: number }
}

interface WebScroller extends WebBox {
  clientHeight: number
  scrollBy: (options: { top: number; behavior: 'smooth' | 'auto' }) => void
  addEventListener: (type: 'scrollend', listener: () => void, options: { once: true }) => void
  removeEventListener: (type: 'scrollend', listener: () => void) => void
}

interface WebRow extends WebBox {
  offsetHeight: number
}

const scrollerOf = (list: unknown): WebScroller | null =>
  (list as { getScrollableNode?: () => WebScroller | null } | null)?.getScrollableNode?.() ?? null

const noop = () => undefined

/**
 * Brings a row to the middle of the list, or its top to the list's top. Moves the list's own
 * scroller alone: `scrollIntoView` scrolls every ancestor that can, the page around the list too.
 */
function bringIn(
  scroller: WebScroller,
  node: WebRow,
  block: 'start' | 'center',
  behavior: 'smooth' | 'auto',
): void {
  const row = node.getBoundingClientRect()
  const box = scroller.getBoundingClientRect()
  const top =
    block === 'start' ? row.top - box.top : (row.top + row.bottom) / 2 - (box.top + box.bottom) / 2
  scroller.scrollBy({ top, behavior })
}

/**
 * The web scrolls to a row by the row's own element: rows just handed to the list have no
 * measurements for the list to scroll by, and the page knows where they are.
 */
export function useRowScroller({
  list,
  scroll,
  rowNodes,
  rowHeights,
}: RowScrollerInput): RowScroller {
  const { target, scrollToTarget, onScrollToIndexFailed, aim } = useIndexTarget(list)
  // Puts the landing's row where it belongs again. A window just swapped in is drawn a batch at
  // a time, and the first scroll stops at the end of the rows drawn by then.
  const placeAgain = useRef<(() => void) | null>(null)

  const scrollTo = useCallback(
    ({ key, index, animated, wasHeld, onArrived }: ScrollToRow) => {
      aim(key, index, rowHeights.get(key), scroll.current.viewportPx)
      placeAgain.current = null
      let frames = 0
      const step = () => {
        frames += 1
        const node = rowNodes.get(key) as WebRow | undefined
        const scroller = scrollerOf(list.current)
        if (node === undefined || scroller === null) {
          // Not drawn yet: towards where the list reckons it is, which draws it.
          scrollToTarget(false)
          if (frames < ROW_FRAMES) requestAnimationFrame(step)
          return
        }
        const block = node.offsetHeight > scroller.clientHeight ? 'start' : 'center'
        const row = node.getBoundingClientRect()
        const box = scroller.getBoundingClientRect()
        // A row the reader can already see has arrived: the rest of it is brought in alongside,
        // and one wholly on screen is left where it is. A row that came with the window was not
        // there to be seen, wherever the scroll left over from the last window puts it.
        const seen = wasHeld && row.bottom > box.top && row.top < box.bottom
        if (seen) onArrived?.()
        if (seen && row.top >= box.top && row.bottom <= box.bottom) return
        const awayPx = Math.abs((row.top + row.bottom) / 2 - (box.top + box.bottom) / 2)
        const smooth = animated && awayPx <= box.bottom - box.top
        if (seen) {
          bringIn(scroller, node, block, smooth ? 'smooth' : 'auto')
          return
        }
        if (smooth && onArrived !== undefined) {
          // Whichever comes first: a row already in place scrolls nowhere and ends no scroll.
          let arrived = false
          const arrive = () => {
            if (arrived) return
            arrived = true
            scroller.removeEventListener('scrollend', arrive)
            onArrived()
          }
          scroller.addEventListener('scrollend', arrive, { once: true })
          setTimeout(arrive, ANIMATED_SCROLL_MS)
        }
        bringIn(scroller, node, block, smooth ? 'smooth' : 'auto')
        if (!smooth) {
          placeAgain.current = () => {
            bringIn(scroller, node, block, 'auto')
          }
          if (onArrived !== undefined) requestAnimationFrame(onArrived)
        }
      }
      step()
    },
    [aim, list, rowHeights, rowNodes, scroll, scrollToTarget],
  )

  const cancel = useCallback(() => {
    target.current = null
    placeAgain.current = null
  }, [target])
  const onContentGrew = useCallback(() => {
    placeAgain.current?.()
  }, [])
  const onReaderTouch = useCallback(() => {
    placeAgain.current = null
  }, [])

  return {
    scrollTo,
    cancel,
    onRowHeight: noop,
    onContentGrew,
    onReaderTouch,
    onScrollStopped: noop,
    holdsStart: () => false,
    onScrollToIndexFailed,
  }
}
