import type { NetworkPath, NetworkPaths } from '@session/client'
import { describe, expect, it } from 'vitest'

import {
  ANY_DESTINATION,
  BUSY_REQUESTS,
  EMPTY_TRACKER,
  expectedPathCount,
  hopMsFor,
  IN_USE_MS,
  inUse,
  pathStats,
  trackSnapshot,
} from '#src/path/pathActivity'

function path(over: Partial<NetworkPath> & { remoteHex: string }): NetworkPath {
  return {
    destination: 'storageNode',
    standby: false,
    hops: [
      { pubkeyHex: 'e1', country: 'DE' },
      { pubkeyHex: 'r1', country: 'US' },
      { pubkeyHex: 'r2', country: 'FI' },
      { pubkeyHex: 'd1', country: 'DE' },
    ],
    latencyMs: 300,
    jitterMs: 10,
    requestsSent: 0,
    proxiedRequestsSent: 0,
    pingsAnswered: 0,
    ...over,
  }
}

function snap(...paths: NetworkPath[]): NetworkPaths {
  return { paths, nodesByCountry: [], countryAttribution: 'credit' }
}

/**
 * `after` as the screen sees it at time 0, having opened on the same paths with nothing sent: the
 * requests it carries are seen, not taken as the baseline.
 */
function seen(after: NetworkPaths) {
  const idle = snap(...after.paths.map((p) => ({ ...p, requestsSent: 0, proxiedRequestsSent: 0 })))
  return trackSnapshot(trackSnapshot(EMPTY_TRACKER, idle, -1_000, 1_000).tracker, after, 0, 1_000)
}

describe('trackSnapshot', () => {
  it('takes the first snapshot as a baseline, not as requests seen', () => {
    const { tracker, requests } = trackSnapshot(
      EMPTY_TRACKER,
      snap(path({ remoteHex: 'a', requestsSent: 12 }), path({ remoteHex: 'b' })),
      1_000,
      1_000,
    )
    expect(requests).toEqual([])
    // Twelve requests at some time before: not a reason to draw the path now.
    expect(inUse(tracker, 1_000)).toEqual([])
  })

  it('sees the requests a total grew by, spread across the poll and capped as a burst', () => {
    const first = trackSnapshot(
      EMPTY_TRACKER,
      snap(path({ remoteHex: 'a', requestsSent: 1 })),
      0,
      1_000,
    )
    const two = trackSnapshot(
      first.tracker,
      snap(path({ remoteHex: 'a', requestsSent: 3 })),
      1_000,
      1_000,
    )
    expect(two.requests.map((r) => r.atMs)).toEqual([1_000, 1_500])
    const burst = trackSnapshot(
      two.tracker,
      snap(path({ remoteHex: 'a', requestsSent: 30 })),
      2_000,
      1_000,
    )
    expect(burst.requests).toHaveLength(4)
    expect(new Set([...two.requests, ...burst.requests].map((r) => r.id)).size).toBe(6)
  })

  it('counts a rebuild when a remote keeps its key but its hops change', () => {
    const first = trackSnapshot(EMPTY_TRACKER, snap(path({ remoteHex: 'a' })), 0, 1_000)
    const moved = path({ remoteHex: 'a', hops: [{ pubkeyHex: 'e2', country: 'NL' }] })
    expect(trackSnapshot(first.tracker, snap(moved), 1_000, 1_000).tracker.rebuilt).toBe(1)
  })

  it('names the file server as the last column and a proxying node as a community', () => {
    const { tracker } = trackSnapshot(
      EMPTY_TRACKER,
      snap(
        path({
          remoteHex: 'f',
          destination: 'fileServer',
          hops: path({ remoteHex: 'x' }).hops.slice(0, 3),
        }),
        path({ remoteHex: 'c', proxiedRequestsSent: 2, requestsSent: 2 }),
      ),
      0,
      1_000,
    )
    expect(tracker.paths.map((p) => [p.kind, p.countries])).toEqual([
      ['file', ['DE', 'US', 'FI', 'FS']],
      ['community', ['DE', 'US', 'FI', 'DE']],
    ])
  })

  it('stops counting a path as in use a minute after its last request', () => {
    const { tracker } = seen(snap(path({ remoteHex: 'a', requestsSent: 1 })))
    expect(inUse(tracker, IN_USE_MS - 1)).toHaveLength(1)
    expect(inUse(tracker, IN_USE_MS)).toHaveLength(0)
  })

  it('always counts the paths to your own swarm and the file server as in use', () => {
    const { tracker } = trackSnapshot(
      EMPTY_TRACKER,
      snap(
        path({ remoteHex: 'n' }),
        path({ remoteHex: 's', destination: 'ownSwarm' }),
        path({ remoteHex: 'f', destination: 'fileServer' }),
      ),
      0,
      1_000,
    )
    expect(inUse(tracker, IN_USE_MS * 10).map((p) => p.key)).toEqual(['s', 'f'])
  })
})

describe('when paths were last used', () => {
  it('knows from the first snapshot which paths are in use, by when each last had a request', () => {
    const { tracker, requests } = trackSnapshot(
      EMPTY_TRACKER,
      snap(
        path({ remoteHex: 'recent', requestsSent: 5, msSinceLastRequest: 2_000 }),
        path({ remoteHex: 'old', requestsSent: 9, msSinceLastRequest: IN_USE_MS + 1 }),
      ),
      0,
      1_000,
    )
    expect(requests).toEqual([])
    expect(inUse(tracker, 0).map((p) => p.key)).toEqual(['recent'])
  })

  it('takes a long gap between polls as a new baseline, not as a burst of requests', () => {
    const first = trackSnapshot(EMPTY_TRACKER, snap(path({ remoteHex: 'a' })), 0, 1_000)
    // A window in the background: the next poll comes a minute late, 40 requests on.
    const back = trackSnapshot(
      first.tracker,
      snap(path({ remoteHex: 'a', requestsSent: 40, pingsAnswered: 12, msSinceLastRequest: 500 })),
      60_000,
      1_000,
    )
    expect(back.requests).toEqual([])
    expect(inUse(back.tracker, 60_000).map((p) => p.key)).toEqual(['a'])
  })

  it('always draws the swarm member last talked to, and another only while in use', () => {
    const swarm = (remoteHex: string, ms: number) =>
      path({ remoteHex, destination: 'ownSwarm', requestsSent: 1, msSinceLastRequest: ms })
    const { tracker } = trackSnapshot(
      EMPTY_TRACKER,
      snap(swarm('s1', 5 * IN_USE_MS), swarm('s2', 3 * IN_USE_MS)),
      0,
      1_000,
    )
    expect(inUse(tracker, 0).map((p) => p.key)).toEqual(['s2'])
  })
})

describe('a remote missing from a snapshot', () => {
  const requestsOn = (requests: readonly { kind: string; pathKey: string }[]) =>
    requests.filter((r) => r.kind === 'request').map((r) => r.pathKey)

  it('draws only what its total grew by when it comes back, not its whole total', () => {
    const open = trackSnapshot(
      EMPTY_TRACKER,
      snap(path({ remoteHex: 'a', requestsSent: 40 })),
      0,
      1_000,
    ).tracker
    const between = trackSnapshot(open, snap(), 1_000, 1_000).tracker
    const back = trackSnapshot(
      between,
      snap(path({ remoteHex: 'a', requestsSent: 41 })),
      2_000,
      1_000,
    )
    expect(requestsOn(back.requests)).toEqual(['a'])
  })

  it('takes a remote first seen after opening as a baseline, unless it sent during the poll', () => {
    const open = trackSnapshot(EMPTY_TRACKER, snap(path({ remoteHex: 'a' })), 0, 1_000).tracker
    const later = (msSinceLastRequest: number) =>
      trackSnapshot(
        open,
        snap(
          path({ remoteHex: 'a' }),
          path({ remoteHex: 'b', requestsSent: 40, msSinceLastRequest }),
        ),
        1_000,
        1_000,
      ).requests
    expect(requestsOn(later(30_000))).toEqual([])
    expect(requestsOn(later(200))).toEqual(['b'])
  })
})

describe('standby paths', () => {
  const spare = (over: Partial<NetworkPath> & { remoteHex: string }) =>
    path({ standby: true, hops: [{ pubkeyHex: 'e7', country: 'SG' }], ...over })

  it("take their session's kind and are drawn while it is in use", () => {
    const { tracker } = seen(
      snap(
        path({ remoteHex: 's', destination: 'ownSwarm' }),
        spare({ remoteHex: 's', destination: 'ownSwarm' }),
        path({ remoteHex: 'c', requestsSent: 1, proxiedRequestsSent: 1 }),
        spare({ remoteHex: 'c' }),
        path({ remoteHex: 'idle' }),
        spare({ remoteHex: 'idle' }),
      ),
    )
    expect(inUse(tracker, 0).map((p) => [p.key, p.kind, p.standby])).toEqual([
      ['s', 'swarm', false],
      ['s~1', 'swarm', true],
      ['c', 'community', false],
      ['c~1', 'community', true],
    ])
  })

  it('counts a build when a route is new to its remote, not when the spare takes over', () => {
    const current = path({ remoteHex: 'a' })
    const standby = spare({ remoteHex: 'a' })
    const first = trackSnapshot(EMPTY_TRACKER, snap(current, standby), 0, 1_000)
    // The spare becomes current, and a new spare is built: one build, not two.
    const swapped = trackSnapshot(
      first.tracker,
      snap(
        { ...current, hops: standby.hops },
        spare({ remoteHex: 'a', hops: [{ pubkeyHex: 'e8', country: 'JP' }] }),
      ),
      1_000,
      1_000,
    )
    expect(swapped.tracker.rebuilt).toBe(1)
  })
})

describe('pings', () => {
  const quiet = (over: Partial<NetworkPath> = {}) => path({ remoteHex: 'a', ...over })

  it('sees a ping when a path answers one, but not on the first look or after a rebuild', () => {
    const first = trackSnapshot(EMPTY_TRACKER, snap(quiet({ pingsAnswered: 7 })), 0, 1_000)
    expect(first.requests).toEqual([])
    const pinged = trackSnapshot(first.tracker, snap(quiet({ pingsAnswered: 8 })), 1_000, 1_000)
    expect(pinged.requests.map((r) => [r.kind, r.pathKey])).toEqual([['ping', 'a']])
    const moved = quiet({ pingsAnswered: 1, hops: [{ pubkeyHex: 'e2', country: 'NL' }] })
    expect(trackSnapshot(pinged.tracker, snap(moved), 2_000, 1_000).requests).toEqual([])
  })

  it('leaves out the pings on a path that has just carried a request', () => {
    const first = trackSnapshot(EMPTY_TRACKER, snap(quiet()), 0, 1_000)
    const both = trackSnapshot(
      first.tracker,
      snap(quiet({ requestsSent: 1, pingsAnswered: 1 })),
      1_000,
      1_000,
    )
    expect(both.requests.map((r) => r.kind)).toEqual(['request'])
  })

  it("keeps your swarm's pings while the client is busy, and leaves out every other", () => {
    const idle = [
      path({ remoteHex: 'a' }),
      path({ remoteHex: 'c' }),
      path({ remoteHex: 's', destination: 'ownSwarm' }),
    ]
    const first = trackSnapshot(EMPTY_TRACKER, snap(...idle, path({ remoteHex: 'b' })), 0, 1_000)
    const busy = trackSnapshot(
      first.tracker,
      snap(
        ...idle.map((p) => ({ ...p, pingsAnswered: 1 })),
        path({ remoteHex: 'b', requestsSent: BUSY_REQUESTS }),
      ),
      1_000,
      1_000,
    )
    expect(busy.requests.filter((r) => r.kind === 'ping').map((r) => r.pathKey)).toEqual(['s'])
  })
})

describe('country order', () => {
  const counted = (...countries: string[]): NetworkPaths => ({
    ...snap(path({ remoteHex: 'a' })),
    nodesByCountry: countries.map((country, i) => ({ country, nodes: 100 - i })),
  })

  it('waits for a snapshot that has counted the countries', () => {
    const first = trackSnapshot(EMPTY_TRACKER, snap(path({ remoteHex: 'a' })), 0, 1_000).tracker
    expect(first.countryOrder).toEqual([])
    expect(trackSnapshot(first, counted('DE', 'US'), 1_000, 1_000).tracker.countryOrder).toEqual([
      'DE',
      'US',
    ])
  })

  it('keeps the first order while the screen is open, so the bars never reorder', () => {
    const first = trackSnapshot(EMPTY_TRACKER, counted('DE', 'US'), 0, 1_000).tracker
    const later = trackSnapshot(first, counted('US', 'DE', 'FI'), 1_000, 1_000).tracker
    expect(later.countryOrder).toEqual(['DE', 'US'])
  })
})

describe('pathStats', () => {
  it('is not onion requests with no path, nor with Session Router paths', () => {
    expect(pathStats(EMPTY_TRACKER, 0).onionRequests).toBe(false)
    const { tracker } = trackSnapshot(EMPTY_TRACKER, snap(path({ remoteHex: 'a' })), 0, 1_000)
    expect(pathStats(tracker, 0).onionRequests).toBe(false)
  })

  it('summarises the paths in use, entry nodes included, leaving out paths not drawn', () => {
    const { tracker } = seen(
      snap(
        path({ remoteHex: 'a', requestsSent: 1, latencyMs: 200, jitterMs: 10 }),
        path({ remoteHex: 'b', requestsSent: 1, latencyMs: 400, jitterMs: 30 }),
        path({ remoteHex: 'idle', hops: [{ pubkeyHex: 'e9', country: 'SG' }] }),
      ),
    )
    expect(pathStats(tracker, 0)).toEqual({
      onionRequests: false,
      pathsInUse: 2,
      countriesCrossed: 3,
      // a and b share e1; the idle path's e9 is not drawn, so not counted.
      entryNodes: 1,
      rebuilt: 0,
      averageMs: 300,
      fastestMs: 200,
      slowestMs: 400,
      jitterMs: 20,
    })
  })

  it('has no timings until a path in use has answered a ping', () => {
    const { tracker } = seen(snap(path({ remoteHex: 'a', requestsSent: 1, latencyMs: 0 })))
    expect(pathStats(tracker, 0).averageMs).toBeNull()
  })
})

describe('hopMsFor', () => {
  it('keeps a slower path slower, within a range that can be followed', () => {
    expect(hopMsFor(200)).toBeLessThan(hopMsFor(500))
    expect(hopMsFor(1)).toBe(140)
    expect(hopMsFor(5_000)).toBe(700)
  })
})

describe('pings just after opening', () => {
  it('counts the client busy from when its sessions last sent, before any request is seen', () => {
    const recent = ['g1', 'g2', 'g3', 'g4'].map((remoteHex) =>
      path({ remoteHex, requestsSent: 3, msSinceLastRequest: 1_000 }),
    )
    const first = trackSnapshot(EMPTY_TRACKER, snap(...recent), 0, 1_000)
    const next = trackSnapshot(
      first.tracker,
      snap(...recent.map((p) => ({ ...p, pingsAnswered: 1, msSinceLastRequest: 2_000 }))),
      1_000,
      1_000,
    )
    expect(next.requests.filter((r) => r.kind === 'ping')).toEqual([])
  })
})

describe('expectedPathCount', () => {
  it("counts your swarm's two paths, which every account has, and no chat's", () => {
    expect(expectedPathCount([])).toBe(2)
    expect(expectedPathCount([{ kind: 'dm' }, { kind: 'dm' }])).toBe(2)
  })
})

describe('onion paths', () => {
  const onion = (remoteHex: string, over: Partial<NetworkPath> = {}): NetworkPath =>
    path({
      remoteHex,
      destination: 'anyNode',
      hops: [
        { pubkeyHex: `${remoteHex}e`, country: 'DE' },
        { pubkeyHex: `${remoteHex}r`, country: 'US' },
        { pubkeyHex: `${remoteHex}x`, country: 'FI' },
      ],
      ...over,
    })

  it('draws every one, used or not, ending at the destination each request names', () => {
    const { tracker } = trackSnapshot(
      EMPTY_TRACKER,
      snap(onion('SP-1'), onion('SP-2'), onion('FP-1', { destination: 'anyFile' })),
      0,
      1_000,
    )
    const used = inUse(tracker, 0)
    expect(used.map((p) => p.key).sort()).toEqual(['FP-1', 'SP-1', 'SP-2'])
    expect(used.find((p) => p.key === 'SP-1')?.countries).toEqual([
      'DE',
      'US',
      'FI',
      ANY_DESTINATION,
    ])
    expect(used.find((p) => p.key === 'FP-1')?.kind).toBe('file')
    // The destination is no country.
    expect(pathStats(tracker, 0).countriesCrossed).toBe(3)
  })

  it('takes the timings from the requests answered, and gives no jitter', () => {
    const { tracker } = trackSnapshot(
      EMPTY_TRACKER,
      snap(
        onion('SP-1', { latencyMs: 400, jitterMs: 0 }),
        onion('SP-2', { latencyMs: 800, jitterMs: 0 }),
        // A file path is never timed, so it leaves the figures alone.
        onion('FP-1', { destination: 'anyFile', latencyMs: 0, jitterMs: 0 }),
      ),
      0,
      1_000,
    )
    const stats = pathStats(tracker, 0)
    expect(stats.onionRequests).toBe(true)
    expect([stats.averageMs, stats.fastestMs, stats.slowestMs]).toEqual([600, 400, 800])
    expect(stats.jitterMs).toBeNull()
  })

  it('counts a path replaced under a new name as rebuilt, and its first request as seen', () => {
    const first = trackSnapshot(EMPTY_TRACKER, snap(onion('SP-1', { requestsSent: 40 })), 0, 1_000)
    const next = trackSnapshot(
      first.tracker,
      snap(onion('SP-2', { requestsSent: 1, msSinceLastRequest: 200 })),
      1_000,
      1_000,
    )
    expect(next.tracker.rebuilt).toBe(1)
    expect(next.requests.map((r) => r.pathKey)).toEqual(['SP-2'])
  })
})
