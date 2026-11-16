import { useCallback, useRef, type RefObject } from 'react'

/** How often a row not yet measured is tried again, and how long between tries. */
const SCROLL_RETRIES = 5
const SCROLL_RETRY_MS = 50
/** How long an animated scroll is given to stop where nothing says that it has. */
export const ANIMATED_SCROLL_MS = 500
/** How many frames a row is waited for, to be drawn or to take focus, before giving up. */
export const ROW_FRAMES = 30

export interface IndexTarget {
  key: string
  index: number
  viewPosition: number
  retries: number
  /** Placed before its row's height was known: put again, once, if the row proves a tall one. */
  unmeasured: boolean
}

interface ScrollsToIndex {
  scrollToIndex: (params: { index: number; viewPosition: number; animated: boolean }) => void
  scrollToOffset: (params: { offset: number; animated: boolean }) => void
}

/** The row a list is being scrolled to by index, and the list's scroll there. */
export function useIndexTarget(list: RefObject<unknown>) {
  const target = useRef<IndexTarget | null>(null)

  const scrollToTarget = useCallback(
    (animated: boolean) => {
      const at = target.current
      if (at === null) return
      ;(list.current as ScrollsToIndex | null)?.scrollToIndex({
        index: at.index,
        viewPosition: at.viewPosition,
        animated,
      })
    },
    [list],
  )

  // A row not measured yet has no offset to scroll to: go to roughly where it is, which
  // measures it, then try again.
  const onScrollToIndexFailed = useCallback(
    (info: { index: number; averageItemLength: number }) => {
      const at = target.current
      if (at === null || at.retries >= SCROLL_RETRIES) return
      at.retries += 1
      ;(list.current as ScrollsToIndex | null)?.scrollToOffset({
        offset: info.averageItemLength * info.index,
        animated: false,
      })
      setTimeout(() => {
        scrollToTarget(false)
      }, SCROLL_RETRY_MS)
    },
    [list, scrollToTarget],
  )

  /** Aims at a row: its middle at the list's, or its top at the list's top for a tall one. */
  const aim = useCallback(
    (key: string, index: number, heightPx: number | undefined, viewportPx: number) => {
      const tall = heightPx !== undefined && heightPx > viewportPx
      target.current = {
        key,
        index,
        viewPosition: tall ? 0 : 0.5,
        retries: 0,
        unmeasured: heightPx === undefined,
      }
    },
    [],
  )

  return { target, scrollToTarget, onScrollToIndexFailed, aim }
}
