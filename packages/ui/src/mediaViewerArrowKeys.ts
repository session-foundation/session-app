import { useEffect } from 'react'

import { isLayoutRtl } from './layoutDirection'
import type { MediaViewerArrowKeysOptions } from './mediaViewerArrowKeys.types'
import { mediaViewerKeyIndex } from './mediaViewerKeys'

/**
 * Pages the viewer with the arrow keys while `enabled`.
 *
 * Heard on the document because focus may be anywhere while the viewer is up, including on the
 * chevron that has just gone disabled at an end.
 */
export function useMediaViewerArrowKeys({
  enabled,
  index,
  count,
  onIndex,
}: MediaViewerArrowKeysOptions): void {
  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent): void => {
      // A modified arrow belongs to the system or to text selection.
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
      if (event.shiftKey || event.isComposing) return
      const next = mediaViewerKeyIndex(event.key, { index, count, rtl: isLayoutRtl() })
      if (next === null) return
      event.preventDefault()
      onIndex(next)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [enabled, index, count, onIndex])
}
