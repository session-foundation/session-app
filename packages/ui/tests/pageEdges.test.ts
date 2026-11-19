import { describe, expect, it } from 'vitest'

import { readEdges, ROWS_AHEAD, type EdgesAsked, type EdgesInput } from '#src/pageEdges'

/** Rows `m{from}` to `m{to}`, as a window holding exactly that run. */
const rows = (from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, i) => `m${String(from + i)}`)

const none: EdgesAsked = { before: undefined, after: undefined }

/** A read of `held` with rows `first` to `last` on screen, history going on both ways. */
function read(
  held: readonly string[],
  first: string,
  last: string,
  more: Partial<EdgesInput> = {},
): ReturnType<typeof readEdges> {
  return readEdges({
    shown: { first, last },
    held,
    moreBefore: true,
    moreAfter: true,
    holdBefore: false,
    holdAfter: false,
    asked: none,
    ...more,
  })
}

describe('readEdges', () => {
  const window = rows(100, 159)

  it('asks for neither page with more than enough rows held beyond those on screen', () => {
    expect(read(window, 'm120', 'm130')?.ask).toEqual({ before: false, after: false })
  })

  it(`asks for the page before once fewer than ${String(ROWS_AHEAD)} rows are held above`, () => {
    expect(read(window, `m${String(100 + ROWS_AHEAD)}`, 'm130')?.ask.before).toBe(false)
    expect(read(window, `m${String(100 + ROWS_AHEAD - 1)}`, 'm130')?.ask.before).toBe(true)
  })

  it(`asks for the page after once fewer than ${String(ROWS_AHEAD)} rows are held below`, () => {
    expect(read(window, 'm120', `m${String(159 - ROWS_AHEAD)}`)?.ask.after).toBe(false)
    expect(read(window, 'm120', `m${String(159 - ROWS_AHEAD + 1)}`)?.ask.after).toBe(true)
  })

  it('asks both ways for rows that do not fill the list', () => {
    expect(read(rows(0, 4), 'm0', 'm4')?.ask).toEqual({ before: true, after: true })
  })

  it('asks for nothing past an end history does not go on beyond', () => {
    const shown = read(rows(0, 9), 'm0', 'm9', { moreBefore: false, moreAfter: false })
    expect(shown?.ask).toEqual({ before: false, after: false })
    // Still near both ends, for the rows that say what is happening there.
    expect(shown?.near).toEqual({ before: true, after: true })
  })

  it('asks once per end row, however often the rows on screen are read again', () => {
    const first = read(window, 'm105', 'm112')
    expect(first?.ask.before).toBe(true)
    // A page that failed leaves the same first row: it waits for its Retry.
    const again = read(window, 'm104', 'm111', { asked: first?.asked ?? none })
    expect(again?.ask.before).toBe(false)
  })

  it('does not ask again once the page above has landed, which shifts the rows on screen away', () => {
    const asked = read(window, 'm105', 'm112')?.asked ?? none
    const landed = [...rows(70, 99), ...window]
    expect(read(landed, 'm105', 'm112', { asked })?.ask.before).toBe(false)
  })

  it('does not ask again once the page below has landed, which moves the end away', () => {
    const asked = read(window, 'm150', 'm157')?.asked ?? none
    const landed = [...window, ...rows(160, 189)]
    expect(read(landed, 'm150', 'm157', { asked })?.ask.after).toBe(false)
  })

  it('asks again for the next page once the reader goes on into the one that landed', () => {
    const asked = read(window, 'm105', 'm112')?.asked ?? none
    const landed = [...rows(70, 99), ...window]
    expect(read(landed, 'm80', 'm87', { asked })?.ask.before).toBe(true)
  })

  it('asks again after the rows on screen leave an end and come back', () => {
    const asked = read(window, 'm105', 'm112')?.asked ?? none
    const away = read(window, 'm130', 'm137', { asked })
    expect(away?.asked.before).toBeUndefined()
    expect(read(window, 'm105', 'm112', { asked: away?.asked ?? none })?.ask.before).toBe(true)
  })

  it('holds an end back without counting it asked, so it asks once let go', () => {
    const held = read(window, 'm105', 'm150', { holdBefore: true, holdAfter: true })
    expect(held?.ask).toEqual({ before: false, after: false })
    const free = read(window, 'm105', 'm150', { asked: held?.asked ?? none })
    expect(free?.ask).toEqual({ before: true, after: true })
  })

  it('reads nothing from rows on screen that are no longer held', () => {
    expect(read(window, 'm10', 'm20')).toBeNull()
  })
})
