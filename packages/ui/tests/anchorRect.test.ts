import { describe, expect, it } from 'vitest'

import { measureAnchor, panelInset, panelPlacement } from '#src/anchorRect'

/**
 * The placement arithmetic, which is the part of a dropdown that is wrong in ways nobody notices
 * until a particular window size: a panel half off the screen, or one opening downwards into a
 * strip too short to hold it.
 */
const GAP = 6
const MARGIN = 12
const MIN = 260

const trigger = (x: number, y: number) => ({ x, y, width: 60, height: 32 })

describe('placing the panel horizontally', () => {
  it('aligns the panel’s right edge with the trigger’s', () => {
    // 600 + 60 - 320. The trigger is narrower than the panel, so the panel hangs to its left.
    expect(panelInset(trigger(600, 100), 320, 1000, MARGIN)).toBe(340)
  })

  it('never runs off the right edge', () => {
    // A trigger in the top-right corner is the common case on a phone.
    expect(panelInset(trigger(320, 20), 320, 390, MARGIN)).toBe(390 - 320 - MARGIN)
  })

  it('never runs off the left edge', () => {
    // A panel wider than the window: the margin wins, and it is clipped rather than shifted out.
    expect(panelInset(trigger(0, 20), 320, 300, MARGIN)).toBe(MARGIN)
  })
})

describe('choosing a side to open on', () => {
  it('opens below when there is room, because the chevron points down', () => {
    const placed = panelPlacement(trigger(600, 80), 900, GAP, MARGIN, MIN)
    expect(placed.side).toBe('below')
    expect(placed.offset).toBe(80 + 32 + GAP)
    expect(placed.available).toBe(900 - 80 - 32 - GAP - MARGIN)
  })

  it('flips above when below cannot hold the panel and above can hold more', () => {
    // A trigger low in a short window: below has 62px, above has 682.
    const placed = panelPlacement(trigger(600, 700), 800, GAP, MARGIN, MIN)
    expect(placed.side).toBe('above')
    // Measured from the bottom of the window, which is what `bottom` takes.
    expect(placed.offset).toBe(800 - 700 + GAP)
    expect(placed.available).toBe(700 - GAP - MARGIN)
  })

  it('takes the whole window, over the trigger, when neither side can hold it', () => {
    // Both sides are too short: below has 110px, above 82. A strip either way shows a row or two.
    const placed = panelPlacement(trigger(600, 100), 260, GAP, MARGIN, MIN)
    expect(placed.side).toBe('below')
    expect(placed.covers).toBe(true)
    expect(placed.offset).toBe(MARGIN)
    expect(placed.available).toBe(260 - 2 * MARGIN)
    // And at the tighter margin a caller asks for when covering.
    expect(panelPlacement(trigger(600, 100), 260, GAP, MARGIN, MIN, 4).available).toBe(252)
  })
})

describe('measuring the trigger', () => {
  it('reads a DOM node through getBoundingClientRect', () => {
    let measured: unknown = 'unset'
    measureAnchor(
      { getBoundingClientRect: () => ({ left: 4, top: 8, width: 60, height: 32 }) },
      (r) => {
        measured = r
      },
    )
    expect(measured).toEqual({ x: 4, y: 8, width: 60, height: 32 })
  })

  it('prefers measureInWindow, which is the one a device has', () => {
    let measured: unknown = 'unset'
    measureAnchor(
      {
        measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => {
          cb(4, 8, 60, 32)
        },
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
      },
      (r) => {
        measured = r
      },
    )
    expect(measured).toEqual({ x: 4, y: 8, width: 60, height: 32 })
  })

  it('answers null rather than a guess when there is nothing to measure', () => {
    // The picker uses the rectangle as its open flag, so null here keeps the panel shut rather
    // than drawing it against made-up coordinates.
    let measured: unknown = 'unset'
    measureAnchor(null, (r) => {
      measured = r
    })
    expect(measured).toBeNull()
  })

  it('aligns to the other edge of the trigger when the layout is mirrored', () => {
    // The trigger sits in the top trailing corner either way, so the panel grows back toward the
    // middle either way -- which is the opposite edge of the anchor in each direction.
    // Both answers are insets from the leading edge, so the mirrored one counts in from the right:
    // 8 there puts the panel's left edge at 692, which is where the unmirrored trigger would sit.
    const anchor = { x: 700, y: 10, width: 60, height: 40 }
    expect(panelInset(anchor, 300, 1000, 8)).toBe(460)
    expect(panelInset(anchor, 300, 1000, 8, true)).toBe(8)
  })

  it('keeps the panel whole against either window edge when mirrored', () => {
    const nearTrailing = { x: 940, y: 10, width: 50, height: 40 }
    expect(panelInset(nearTrailing, 300, 1000, 8, true)).toBe(8)
    const nearLeading = { x: 4, y: 10, width: 50, height: 40 }
    expect(panelInset(nearLeading, 300, 1000, 8, true)).toBe(692)
  })
})
