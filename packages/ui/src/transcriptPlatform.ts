import { useLayoutEffect, useRef, useState } from 'react'

import type { TranscriptPlatform, TranscriptPlatformInput } from './transcriptPlatform.types'

interface WebScroller {
  scrollTop: number
  scrollHeight: number
}

const scrollerOf = (list: unknown): WebScroller | null =>
  (list as { getScrollableNode?: () => WebScroller | null } | null)?.getScrollableNode?.() ?? null

/**
 * The web scrolls by wheel and keys, all of it the reader's. Drawn a batch of rows at a time, a
 * page leaves a wide zone at the start in reach until it is all drawn, and asks for the next: so
 * half a list height.
 */
const START_VIEWPORTS = 0.5

/** The web: Chromium's scroll anchoring keeps the place, with the help it needs here. */
export function useTranscriptPlatform({
  list,
  keys,
  atEnd,
  firstPassRows,
  toEnd,
  onPlaced,
}: TranscriptPlatformInput): TranscriptPlatform {
  // Anchoring needs the rows on screen to stay mounted through the commit that adds a page above
  // them: FlatList drops every row past the ones it always draws when its data changes. So those
  // reach past the page just added.
  const [alwaysDrawn, setAlwaysDrawn] = useState({ firstKey: keys[0], rows: firstPassRows })
  if (alwaysDrawn.firstKey !== keys[0]) {
    const addedAbove = alwaysDrawn.firstKey === undefined ? -1 : keys.indexOf(alwaysDrawn.firstKey)
    setAlwaysDrawn({ firstKey: keys[0], rows: Math.max(addedAbove, 0) + firstPassRows })
  }

  // The first pass is drawn before this runs and painted after it, so the list is never seen at
  // its start.
  useLayoutEffect(() => {
    toEnd(false)
    onPlaced()
  }, [toEnd, onPlaced])

  // Anchoring does nothing at offset 0, where rows added above would be scrolled to rather than
  // past: move past them by what they added.
  const heldFirstKey = useRef<string | undefined>(undefined)
  const heldHeightPx = useRef(0)
  useLayoutEffect(() => {
    const node = scrollerOf(list.current)
    if (node === null) return
    const first = heldFirstKey.current
    const grewAbove = first !== undefined && keys.indexOf(first) > 0
    const grownPx = node.scrollHeight - heldHeightPx.current
    if (grewAbove && grownPx > 0 && node.scrollTop < 1 && !atEnd.current) node.scrollTop = grownPx
    heldFirstKey.current = keys[0]
    heldHeightPx.current = node.scrollHeight
  }, [keys, list, atEnd])

  return {
    listProps: { initialNumToRender: alwaysDrawn.rows },
    readerScrolled: () => true,
    untouched: () => false,
    startViewports: START_VIEWPORTS,
    pinsEdges: false,
  }
}
