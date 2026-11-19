import { describe, expect, it } from 'vitest'

import { pathFlowTripMs, travellingPaths, type PathFlowPath } from '#src/PathFlow'

const path: PathFlowPath = {
  key: 'p',
  kind: 'node',
  countries: ['DE', 'US', 'FI', 'DE'],
  lit: false,
}
const HOP = 300
const tripMs = pathFlowTripMs(HOP, 'node', true)

describe('travellingPaths', () => {
  it('keeps a path lit until a request started late reaches home', () => {
    // Set off at 0, but its path was drawn at 5 s, so it is drawn from 5 s.
    const late = { id: 'r', pathKey: 'p', startMs: 5_000, hopMs: HOP }
    expect(travellingPaths([late], [path], true, 5_000 + tripMs - 1).has('p')).toBe(true)
    expect(travellingPaths([late], [path], true, 5_000 + tripMs).has('p')).toBe(false)
  })

  it('leaves out pings, which never light a path', () => {
    const ping = { id: 'q', pathKey: 'p', startMs: 0, hopMs: HOP, quiet: true }
    expect(travellingPaths([ping], [path], true, 1).size).toBe(0)
  })
})
