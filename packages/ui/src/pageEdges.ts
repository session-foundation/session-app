/** How many rows a transcript keeps held beyond those on screen, at each end with more history. */
export const ROWS_AHEAD = 15

/** For each end, the end row held when its page was last asked for: undefined to ask afresh. */
export interface EdgesAsked {
  before: string | undefined
  after: string | undefined
}

export interface EdgesInput {
  /** The first and last row on screen, by key. */
  shown: { first: string; last: string }
  /** Every row held, oldest first, by key. */
  held: readonly string[]
  /** Whether history goes on before the first row held, and after the last. */
  moreBefore: boolean
  moreAfter: boolean
  /** Whether asking at an end is held back for now: it is asked once that ends. */
  holdBefore: boolean
  holdAfter: boolean
  asked: EdgesAsked
}

export interface EdgesRead {
  /** Whether the rows on screen are within `ahead` rows of each end held, history beyond or not. */
  near: { before: boolean; after: boolean }
  /** The pages to ask for now. */
  ask: { before: boolean; after: boolean }
  /** What to remember for the next read. */
  asked: EdgesAsked
}

/**
 * Which pages to ask for, given the rows on screen: the one past an end where history goes on and
 * fewer than `ahead` rows are held between it and the rows on screen.
 *
 * Counted in rows rather than pixels, so whatever moved the list, the reader, the list itself or a
 * page landing, the answer is the same, and it holds the moment the rows change: a page that lands
 * above shifts every row on screen down by its size, which puts the start out of reach again, and
 * one that lands below moves the end away by its size.
 *
 * Each end asks once per end row held, and again once the rows on screen leave its reach and come
 * back: a page that failed waits for its Retry, or for the reader to come back to it.
 *
 * Null when the rows on screen were reported against rows no longer held: the next report is on
 * its way.
 */
export function readEdges(input: EdgesInput, ahead: number = ROWS_AHEAD): EdgesRead | null {
  const { shown, held, moreBefore, moreAfter, holdBefore, holdAfter, asked } = input
  const first = held.indexOf(shown.first)
  const last = held.indexOf(shown.last)
  if (first === -1 || last === -1) return null
  const near = { before: first < ahead, after: last >= held.length - ahead }

  const firstHeld = held[0]
  let askedBefore = asked.before
  let askBefore = false
  if (!near.before || !moreBefore) askedBefore = undefined
  else if (!holdBefore && firstHeld !== undefined && askedBefore !== firstHeld) {
    askedBefore = firstHeld
    askBefore = true
  }

  const lastHeld = held[held.length - 1]
  let askedAfter = asked.after
  let askAfter = false
  if (!near.after || !moreAfter) askedAfter = undefined
  else if (!holdAfter && lastHeld !== undefined && askedAfter !== lastHeld) {
    askedAfter = lastHeld
    askAfter = true
  }

  return {
    near,
    ask: { before: askBefore, after: askAfter },
    asked: { before: askedBefore, after: askedAfter },
  }
}
