import { describe, expect, it } from 'vitest'

import { journeyAt, journeyOf, NODE_HOLD_MS, ringsAt } from '#src/pathFlowJourney'
import { FLOW_SIDE, layoutPathFlow, pointAlong } from '#src/pathFlowLayout'

const HOP = 300

describe('journeyOf', () => {
  it('stops at every node, takes a layer off on the way out and puts one on on the way back', () => {
    const j = journeyOf(HOP, 4, 'request')
    // Out to the entry node, then held there with one layer gone.
    expect(journeyAt(j, HOP / 2)).toEqual({ h: 0.5, back: false, layers: 4 })
    expect(journeyAt(j, HOP + NODE_HOLD_MS / 2)).toEqual({ h: 1, back: false, layers: 3 })
    expect(ringsAt(j, HOP + 10).map((r) => [r.ring.kind, r.ring.hop])).toEqual([['peel', 1]])

    const homeward = j.legs.find((leg) => leg.toHop < leg.fromHop)
    expect(homeward).toBeDefined()
    if (!homeward) return
    // The destination read it bare and sent the answer back wrapped once.
    expect(journeyAt(j, homeward.startMs + 1)).toMatchObject({ back: true, layers: 1 })
    // Home with every layer the nodes put on, taken off at once.
    expect(journeyAt(j, j.totalMs - 1)?.layers).toBe(4)
    expect(j.rings.at(-1)).toMatchObject({ hop: 0, kind: 'open' })
    expect(journeyAt(j, j.totalMs)).toBeNull()
  })

  it('reaches the file server bare: its last column lies past the relay that unwraps it', () => {
    const j = journeyOf(HOP, 3, 'request')
    const atServer = j.legs.find((leg) => leg.fromHop === 4 && leg.toHop === 4)
    expect(atServer?.layers).toBe(0)
    expect(j.rings.filter((r) => r.hop === 4)).toEqual([])
  })

  it('wraps a ping as it does a request, without stopping, and turns it at the last relay', () => {
    // To the file server's path: three relays, the third answering.
    const j = journeyOf(HOP, 3, 'ping')
    expect(j.totalMs).toBe(6 * HOP)
    expect(j.rings).toEqual([])
    expect(journeyAt(j, HOP / 2)?.layers).toBe(3)
    expect(journeyAt(j, 3 * HOP + 1)).toMatchObject({ back: true, layers: 1 })
    expect(Math.max(...j.legs.map((leg) => leg.toHop))).toBe(3)
  })

  it('goes out and back without stopping when drawn without layers', () => {
    const j = journeyOf(HOP, 4, 'plain')
    expect(j.totalMs).toBe(8 * HOP)
    expect(j.rings).toEqual([])
  })
})

describe('pointAlong', () => {
  it('stops a request in the middle of each bar, and runs the line between their edges', () => {
    const layout = layoutPathFlow([{ key: 'p', countries: ['DE', 'US', 'FI', 'DE'] }], 380, 190)
    const pts = layout.points.get('p') ?? []
    for (let h = 0; h <= 4; h += 1) {
      const [x] = pointAlong(pts, h, layout.barWidth)
      expect(x).toBeCloseTo((layout.columnX[h] ?? 0) + layout.barWidth / 2)
    }
    // The destination's bar is as far from the right edge as yours is from the left, and the
    // relays' are evenly between.
    expect(380 - ((layout.columnX[4] ?? 0) + layout.barWidth)).toBe(layout.columnX[0])
    expect(layout.columnX[0]).toBe(FLOW_SIDE)
    const steps = layout.columnX.slice(1).map((x, k) => x - (layout.columnX[k] ?? 0))
    for (const step of steps) expect(step).toBeCloseTo(steps[0] ?? 0)
  })
})
