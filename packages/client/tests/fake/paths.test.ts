import { describe, expect, it } from 'vitest'

import { fakeNetworkPaths } from '#src/fake/paths'

const MINUTE = 60_000

describe('fakeNetworkPaths', () => {
  it('gives every remote one current path and one standby, as the router keeps a spare', () => {
    for (const traffic of ['quiet', 'busy'] as const) {
      const { paths } = fakeNetworkPaths(10 * MINUTE, traffic)
      const current = new Map<string, number>()
      for (const p of paths)
        if (!p.standby) current.set(p.remoteHex, (current.get(p.remoteHex) ?? 0) + 1)
      expect([...current.values()].every((n) => n === 1)).toBe(true)
      expect(new Set(paths.map((p) => p.remoteHex)).size).toBe(current.size)
    }
  })

  it('probes your swarm and 36 groups, and opens a session per community poll', () => {
    const at = (ms: number) => fakeNetworkPaths(ms, 'busy').paths.filter((p) => !p.standby)
    const now = at(10 * MINUTE)
    expect(now.filter((p) => p.destination === 'ownSwarm')).toHaveLength(1)
    const proxied = now.filter((p) => p.proxiedRequestsSent > 0)
    // Every 5 and every 11 seconds, each through a node of its own, open for 75 seconds.
    expect(proxied.length).toBeGreaterThan(20)
    expect(new Set(proxied.map((p) => p.remoteHex)).size).toBe(proxied.length)
    // A group's total grows by one a probe, every 30 seconds.
    const group = (ps: typeof now) => ps.find((p) => p.remoteHex === now[2]?.remoteHex)
    const before = group(now)?.requestsSent ?? 0
    expect(group(at(10 * MINUTE + 30_000))?.requestsSent).toBe(before + 1)
  })

  it('builds every path from one of four entry nodes, as the router does', () => {
    const { paths } = fakeNetworkPaths(10 * MINUTE, 'busy')
    expect(new Set(paths.map((p) => p.hops[0]?.pubkeyHex)).size).toBeLessThanOrEqual(4)
  })

  it('opens on an account that has been running a while: every group probed in the last minute', () => {
    const groups = fakeNetworkPaths(0, 'busy').paths.filter(
      (p) => !p.standby && p.destination === 'storageNode' && p.proxiedRequestsSent === 0,
    )
    expect(groups).toHaveLength(36)
    expect(groups.every((p) => (p.msSinceLastRequest ?? Infinity) < 60_000)).toBe(true)
  })

  it('holds no paths before the network has connected', () => {
    expect(fakeNetworkPaths(null, 'busy').paths).toEqual([])
  })

  it('holds no paths sending direct, though it knows the network', () => {
    const snapshot = fakeNetworkPaths(10 * MINUTE, 'quiet', 'direct')
    expect(snapshot.paths).toEqual([])
    expect(snapshot.nodesByCountry.length).toBeGreaterThan(0)
  })

  it("keeps onion requests' paths: three hops, two for files, no pings", () => {
    const { paths } = fakeNetworkPaths(10 * MINUTE, 'quiet', 'onion-requests')
    expect(paths.map((p) => p.destination).sort()).toEqual([
      'anyFile',
      'anyFile',
      'anyNode',
      'anyNode',
    ])
    expect(paths.every((p) => p.hops.length === 3 && !p.standby && p.pingsAnswered === 0)).toBe(
      true,
    )
    expect(fakeNetworkPaths(10 * MINUTE, 'busy', 'onion-requests').paths).toHaveLength(6)
    // Timed only where it is no file path, and never with jitter.
    expect(paths.every((p) => p.jitterMs === 0)).toBe(true)
    expect(paths.every((p) => (p.destination === 'anyFile') === (p.latencyMs === 0))).toBe(true)
  })

  it('names a replaced onion path afresh and starts its count again', () => {
    const at = (ms: number) => fakeNetworkPaths(ms, 'quiet', 'onion-requests').paths[0]
    const before = at(9.9 * MINUTE)
    const after = at(10.1 * MINUTE)
    expect(after?.remoteHex).not.toBe(before?.remoteHex)
    expect(after?.requestsSent ?? 0).toBeLessThan(before?.requestsSent ?? 0)
  })
})
