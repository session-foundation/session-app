import { useCallback, useRef } from 'react'

import { ANIMATED_SCROLL_MS, useIndexTarget } from './indexTarget'
import type { RowScroller, RowScrollerInput, ScrollToRow } from './rowScroller.types'

/** A row within this many rows of what is on screen is near enough to animate to. */
const NEAR_ROWS = 8
/** How long a row not laid out when it was asked for is waited for before giving up. */
const UNMEASURED_ROW_MS = 1500
/** How long a jump to a row already laid out is given to land: it reports no end of its own. */
const JUMP_LANDS_MS = 100

/**
 * Native scrolls to a row by its index, and a guess at where in the list it sits until the rows
 * around it are measured: so it is put again once the row is laid out, and arrives then.
 */
export function useRowScroller({
  list,
  scroll,
  rowHeights,
  onScreen,
}: RowScrollerInput): RowScroller {
  const { target, scrollToTarget, onScrollToIndexFailed, aim } = useIndexTarget(list)
  /** What to call once the scroll to a row has stopped. */
  const arrival = useRef<(() => void) | null>(null)

  const scrollTo = useCallback(
    ({ key, index, animated, wasHeld, onArrived }: ScrollToRow) => {
      const heightPx = rowHeights.get(key)
      aim(key, index, heightPx, scroll.current.viewportPx)
      const shown = onScreen.current
      // A row the reader can already see has arrived: the rest of it is brought in alongside, and
      // one between two rows on screen, so wholly on screen, is left where it is.
      const seen = wasHeld && shown !== null && index >= shown.first && index <= shown.last
      if (seen) onArrived?.()
      if (wasHeld && shown !== null && index > shown.first && index < shown.last) {
        target.current = null
        return
      }
      const near =
        wasHeld &&
        shown !== null &&
        index >= shown.first - NEAR_ROWS &&
        index <= shown.last + NEAR_ROWS
      scrollToTarget(animated && near)
      if (onArrived === undefined || seen) return
      // An animated scroll says when it stops; the wait is for one that moved nowhere, and for a
      // jump, which reports no end at all.
      const arrive = () => {
        if (arrival.current !== arrive) return
        arrival.current = null
        onArrived()
      }
      arrival.current = arrive
      // A row not laid out yet arrives when it is: see `onRowHeight`. The wait is then only for a
      // row that never is.
      const waitMs =
        heightPx === undefined
          ? UNMEASURED_ROW_MS
          : animated && near
            ? ANIMATED_SCROLL_MS
            : JUMP_LANDS_MS
      setTimeout(arrive, waitMs)
    },
    [aim, onScreen, rowHeights, scroll, scrollToTarget, target],
  )

  const onRowHeight = useCallback(
    (key: string, heightPx: number) => {
      const at = target.current
      if (at === null || at.key !== key || !at.unmeasured) return
      at.unmeasured = false
      // Put again now that the list knows where the row is: the first try went by the rows that
      // were there before. Then it has arrived, ahead of the rows still being drawn around it.
      if (heightPx > scroll.current.viewportPx) at.viewPosition = 0
      scrollToTarget(false)
      requestAnimationFrame(() => arrival.current?.())
    },
    [scroll, scrollToTarget, target],
  )

  const cancel = useCallback(() => {
    target.current = null
  }, [target])
  // The reader has taken the scroll: a height that arrives now must not move it.
  const onReaderTouch = useCallback(() => {
    if (target.current !== null) target.current.unmeasured = false
  }, [target])
  const onScrollStopped = useCallback(() => {
    arrival.current?.()
  }, [])

  return {
    scrollTo,
    cancel,
    onRowHeight,
    onContentGrew: () => undefined,
    onReaderTouch,
    onScrollStopped,
    // A window just swapped in sits at its start until its landing row is laid out. Rows added
    // above before then are not held in place on iOS, and the landing is lost.
    holdsStart: () => target.current?.unmeasured === true,
    onScrollToIndexFailed,
  }
}
