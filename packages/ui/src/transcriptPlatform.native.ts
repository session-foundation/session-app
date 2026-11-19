import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'

import type { TranscriptPlatform, TranscriptPlatformInput } from './transcriptPlatform.types'

/** How long after a finger lifts its fling is waited for. */
const FLING_BEGINS_MS = 150
const KEEPS_PLACE = { minIndexForVisible: 0 } as const

/**
 * Native: `maintainVisibleContentPosition` keeps the place, and moves the scroll itself to do it
 * as rows change size. A finger, or the fling it left, is the reader's whenever it moves the list.
 */
export function useTranscriptPlatform({
  firstPassRows,
  onReaderTouch,
  onReaderDrag,
  onScrollStopped,
}: TranscriptPlatformInput): TranscriptPlatform {
  const told = useRef({ onReaderTouch, onReaderDrag, onScrollStopped })
  useLayoutEffect(() => {
    told.current = { onReaderTouch, onReaderDrag, onScrollStopped }
  })
  const touched = useRef(false)
  const everTouched = useRef(false)
  const touchEnding = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const onTouchBegin = useCallback(() => {
    clearTimeout(touchEnding.current)
    touched.current = true
    everTouched.current = true
    told.current.onReaderTouch()
  }, [])
  const onDragBegin = useCallback(() => {
    onTouchBegin()
    told.current.onReaderDrag()
  }, [onTouchBegin])
  const onTouchEnd = useCallback(() => {
    clearTimeout(touchEnding.current)
    // A fling goes on after the finger lifts, and says so only once it has begun.
    touchEnding.current = setTimeout(() => {
      touched.current = false
    }, FLING_BEGINS_MS)
  }, [])
  const onMomentumScrollEnd = useCallback(() => {
    onTouchEnd()
    told.current.onScrollStopped()
  }, [onTouchEnd])
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
      onScrollBeginDrag: onDragBegin,
      onMomentumScrollBegin: onTouchBegin,
      onScrollEndDrag: onTouchEnd,
      onMomentumScrollEnd,
    },
    readerScrolled: () => touched.current,
    untouched: () => !everTouched.current,
    beforeStartAsked: () => undefined,
  }
}
