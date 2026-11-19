import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { TranscriptPlatform, TranscriptPlatformInput } from './transcriptPlatform.types'

interface WebScroller extends EventTarget {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

const scrollerOf = (list: unknown): WebScroller | null =>
  (list as { getScrollableNode?: () => WebScroller | null } | null)?.getScrollableNode?.() ?? null

/** How the reader moves the list on the web, besides the keys below. */
const READER_EVENTS = ['wheel', 'touchstart', 'pointerdown'] as const
/** The keys that scroll the list, or step the focus through its rows. */
const SCROLL_KEYS: ReadonlySet<string> = new Set([
  'ArrowUp',
  'ArrowDown',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  ' ',
])

/** The web: Chromium's scroll anchoring keeps the place, with the help it needs here. */
export function useTranscriptPlatform({
  list,
  keys,
  atEnd,
  onScreen,
  firstPassRows,
  toEnd,
  onPlaced,
  onReaderTouch,
  onReaderDrag,
}: TranscriptPlatformInput): TranscriptPlatform {
  // Anchoring needs the rows on screen to stay mounted through the commit that adds a page above
  // them: FlatList drops every row past the ones it always draws when its data changes. So those
  // reach past the page just added and the last row on screen before it.
  const [alwaysDrawn, setAlwaysDrawn] = useState({ firstKey: keys[0], rows: firstPassRows })
  if (alwaysDrawn.firstKey !== keys[0]) {
    const addedAbove = alwaysDrawn.firstKey === undefined ? -1 : keys.indexOf(alwaysDrawn.firstKey)
    const reachedRows = Math.max(firstPassRows, (onScreen.current?.last ?? 0) + 1)
    setAlwaysDrawn({ firstKey: keys[0], rows: Math.max(addedAbove, 0) + reachedRows })
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

  const told = useRef({ onReaderTouch, onReaderDrag })
  useLayoutEffect(() => {
    told.current = { onReaderTouch, onReaderDrag }
  })
  // Every scroll on the web is taken for the reader's, but a landing's own placing goes on until
  // the reader is seen to move the list, which a scroll event cannot tell from that placing.
  useEffect(() => {
    const node = scrollerOf(list.current)
    if (node === null) return undefined
    const reader = (event: Event) => {
      if (event instanceof KeyboardEvent && !SCROLL_KEYS.has(event.key)) return
      // On the scroller itself, not a row: its scrollbar.
      if (event.type === 'pointerdown' && event.target !== node) return
      told.current.onReaderTouch()
      told.current.onReaderDrag()
    }
    for (const type of READER_EVENTS) node.addEventListener(type, reader, { passive: true })
    node.addEventListener('keydown', reader)
    return () => {
      for (const type of READER_EVENTS) node.removeEventListener(type, reader)
      node.removeEventListener('keydown', reader)
    }
  }, [list])

  return {
    listProps: { initialNumToRender: alwaysDrawn.rows },
    readerScrolled: () => true,
    untouched: () => false,
    // Chromium anchors nothing at offset 0, so the page about to land above a reader resting there
    // would be shown from its first row. A pixel down, its anchoring keeps the reader's row.
    beforeStartAsked: () => {
      const node = scrollerOf(list.current)
      if (node !== null && node.scrollTop < 1 && node.scrollHeight > node.clientHeight)
        node.scrollTop = 1
    },
  }
}
