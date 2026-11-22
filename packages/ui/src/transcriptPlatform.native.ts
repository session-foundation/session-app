import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { Platform } from 'react-native'

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
  onScrolledToTop,
}: TranscriptPlatformInput): TranscriptPlatform {
  const told = useRef({ onReaderTouch, onReaderDrag, onScrollStopped, onScrolledToTop })
  useLayoutEffect(() => {
    told.current = { onReaderTouch, onReaderDrag, onScrollStopped, onScrolledToTop }
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
  // Android begins momentum for a programmatic animated scroll too: only a fling's is the reader's.
  const onMomentumBegin = useCallback(() => {
    if (touched.current) onTouchBegin()
  }, [onTouchBegin])
  const onMomentumScrollEnd = useCallback(() => {
    onTouchEnd()
    told.current.onScrollStopped()
  }, [onTouchEnd])
  const onScrollToTop = useCallback(() => {
    told.current.onScrolledToTop()
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
      onScrollBeginDrag: onDragBegin,
      onMomentumScrollBegin: onMomentumBegin,
      onScrollEndDrag: onTouchEnd,
      onMomentumScrollEnd,
      onScrollToTop,
    },
    scrollsToTop: Platform.OS === 'ios',
    readerScrolled: () => touched.current,
    untouched: () => !everTouched.current,
    beforeStartAsked: () => undefined,
  }
}
