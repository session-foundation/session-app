import { useCallback, useEffect, useRef } from 'react'

import type { TranscriptPlatform, TranscriptPlatformInput } from './transcriptPlatform.types'

/** How long after a finger lifts its fling is waited for. */
const FLING_BEGINS_MS = 150
/** Far enough out that a fling does not reach the first row before the page above it arrives. */
const START_VIEWPORTS = 2
const KEEPS_PLACE = { minIndexForVisible: 0 } as const

/**
 * Native: `maintainVisibleContentPosition` keeps the place, and moves the scroll itself to do it
 * as rows change size. A finger, or the fling it left, is the reader's whenever it moves the list.
 */
export function useTranscriptPlatform({
  firstPassRows,
}: TranscriptPlatformInput): TranscriptPlatform {
  const touched = useRef(false)
  const everTouched = useRef(false)
  const touchEnding = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const onTouchBegin = useCallback(() => {
    clearTimeout(touchEnding.current)
    touched.current = true
    everTouched.current = true
  }, [])
  const onTouchEnd = useCallback(() => {
    clearTimeout(touchEnding.current)
    // A fling goes on after the finger lifts, and says so only once it has begun.
    touchEnding.current = setTimeout(() => {
      touched.current = false
    }, FLING_BEGINS_MS)
  }, [])
  useEffect(
    () => () => {
      clearTimeout(touchEnding.current)
    },
    [],
  )

  return {
    listProps: {
      initialNumToRender: firstPassRows,
      // Neither legacy mobile client draws one, and on a paged list it jumps as each page lands.
      showsVerticalScrollIndicator: false,
      maintainVisibleContentPosition: KEEPS_PLACE,
      onScrollBeginDrag: onTouchBegin,
      onMomentumScrollBegin: onTouchBegin,
      onScrollEndDrag: onTouchEnd,
      onMomentumScrollEnd: onTouchEnd,
    },
    readerScrolled: () => touched.current,
    untouched: () => !everTouched.current,
    startViewports: START_VIEWPORTS,
    pinsEdges: true,
    beforeStartAsked: () => undefined,
  }
}
