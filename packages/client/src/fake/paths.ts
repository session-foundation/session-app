import type {
  CountryNodes,
  NetworkPath,
  NetworkPaths,
  PathDestination,
  RouterKind,
} from '@session/bridge-types'

/**
 * The fake's paths: a handful shaped like Session Router's, with the countries real relays are in,
 * or onion requests' where the network was attached with that router (see `onionPaths`).
 *
 * What a caller can rely on, and what the fake keeps to:
 *
 *   - none at all until the network has connected, and none once it is gone;
 *   - four hops to a storage node, the last being the node, and three to the file server;
 *   - every path's first hop one of four entry nodes, as the router keeps;
 *   - request totals that only grow, so two snapshots tell what went in between;
 *   - a ping answered along every path every five seconds, counted from when it was last built;
 *   - a path to the same remote keeps its remote when its hops change;
 *   - each remote has a standby path beside its current one, as the router keeps a spare, with
 *     no requests of its own but answering pings.
 *
 * The totals grow with the world's clock rather than with what the account does, because the
 * screen is about traffic over time and the fake sends nothing over a network. The countries are
 * weighted as the live network's are, mostly Germany, the United States and Finland.
 */

const ATTRIBUTION = 'IP Geolocation by DB-IP (https://db-ip.com)'

/** How often the router pings each path. */
const PING_EVERY_MS = 5_000

/**
 * The node cache by country: the order the network had in November 2026, with counts made up to
 * match it. What `nodesByCountry` reports once there is a network.
 */
const NODES_BY_COUNTRY: readonly CountryNodes[] = [
  { country: 'DE', nodes: 420 }, { country: 'US', nodes: 260 }, { country: 'FI', nodes: 150 },
  { country: 'GB', nodes: 90 }, { country: 'CA', nodes: 70 }, { country: 'FR', nodes: 60 },
  { country: 'NL', nodes: 55 }, { country: 'SE', nodes: 30 }, { country: 'SG', nodes: 28 },
  { country: 'PL', nodes: 20 }, { country: 'ZA', nodes: 15 }, { country: 'AU', nodes: 14 },
  { country: 'BG', nodes: 12 }, { country: 'JP', nodes: 10 }, { country: 'CZ', nodes: 9 },
  { country: 'AE', nodes: 8 }, { country: 'IE', nodes: 7 }, { country: 'TH', nodes: 6 },
  { country: 'IN', nodes: 5 }, { country: 'MY', nodes: 4 }, { country: 'KR', nodes: 3 },
  { country: 'IT', nodes: 3 }, { country: 'RO', nodes: 2 }, { country: 'TR', nodes: 2 },
] // prettier-ignore

/** Countries in roughly the proportions the network's relays are in. */
const RELAY_COUNTRIES = ['DE', 'DE', 'DE', 'US', 'US', 'FI', 'FI', 'CA', 'NL', 'FR', 'GB', 'SG']

interface FakePathSpec {
  remoteHex: string
  destination: PathDestination
  /** How often a request goes along it, on the world's clock. */
  everyMs: number
  /** How often its hops are replaced. */
  rebuildMs: number
  proxied: boolean
}

function hex64(seed: number): string {
  return seed.toString(16).padStart(8, '0').repeat(8)
}

const SPECS: readonly FakePathSpec[] = [
  {
    remoteHex: hex64(0x51),
    destination: 'ownSwarm',
    everyMs: 5_000,
    rebuildMs: 600_000,
    proxied: false,
  },
  {
    remoteHex: hex64(0x52),
    destination: 'storageNode',
    everyMs: 7_000,
    rebuildMs: 480_000,
    proxied: false,
  },
  {
    remoteHex: hex64(0x53),
    destination: 'storageNode',
    everyMs: 11_000,
    rebuildMs: 540_000,
    proxied: false,
  },
  {
    remoteHex: hex64(0x54),
    destination: 'storageNode',
    everyMs: 23_000,
    rebuildMs: 420_000,
    proxied: true,
  },
  {
    remoteHex: hex64(0x55),
    destination: 'fileServer',
    everyMs: 41_000,
    rebuildMs: 720_000,
    proxied: false,
  },
]

/** The router's entry nodes: a client keeps four and builds every path from one of them. */
const ENTRY_NODES = 4

/** A path's hops: an entry node, then relays, the last being the destination where it is one. */
function hopsFor(base: number, count: number): { pubkeyHex: string; country: string }[] {
  return Array.from({ length: count }, (_, k) =>
    k === 0 ? relay(0x900 + (base % ENTRY_NODES)) : relay(base + k * 5),
  )
}

function relay(seed: number): { pubkeyHex: string; country: string } {
  return {
    pubkeyHex: hex64(0x1000 + seed),
    country: RELAY_COUNTRIES[seed % RELAY_COUNTRIES.length] ?? 'DE',
  }
}

function pathOf(
  spec: FakePathSpec,
  index: number,
  elapsedMs: number,
  standby: boolean,
): NetworkPath {
  const build = Math.floor(elapsedMs / spec.rebuildMs)
  const base = index * 7 + build * 13 + (standby ? 3 : 0)
  const hopCount = spec.destination === 'fileServer' ? 3 : 4
  const hops = hopsFor(base, hopCount)
  const requestsSent = standby ? 0 : Math.floor(elapsedMs / spec.everyMs)
  return {
    remoteHex: spec.remoteHex,
    destination: spec.destination,
    standby,
    hops,
    latencyMs: 180 + ((base * 37) % 260),
    jitterMs: 4 + ((base * 11) % 30),
    requestsSent,
    proxiedRequestsSent: spec.proxied ? requestsSent : 0,
    ...(requestsSent > 0 ? { msSinceLastRequest: elapsedMs % spec.everyMs } : {}),
    pingsAnswered: Math.floor((elapsedMs - build * spec.rebuildMs) / PING_EVERY_MS),
  }
}

/**
 * How much the fake's account does: `quiet` is a new account's handful of paths; `busy` is an
 * account in 36 groups and two communities, as a legacy client's log of one has it, estimated for
 * Session Router.
 */
export type FakePathTraffic = 'quiet' | 'busy'

export const FAKE_PATH_TRAFFIC: readonly FakePathTraffic[] = ['quiet', 'busy']

/**
 * The busy account, from a legacy iOS client's log (November 2026) of an account in 36 groups and
 * two communities, with what Session Router changes:
 *
 *   - your swarm and each group's are subscribed to, so each sees one request every 30 seconds,
 *     the subscription's probe, where the legacy client polled every 2 seconds and every 30;
 *   - a community has no subscription, so it is still polled, every 5 and every 11 seconds as in
 *     the log, and each poll goes through a node no other request is using: a new session, with
 *     paths of its own, every time;
 *   - the file server now and then, for a display picture or an attachment.
 */
const BUSY_GROUPS = 36
const PROBE_EVERY_MS = 30_000
const COMMUNITY_POLL_MS = [5_000, 11_000] as const
const FILE_EVERY_MS = 45_000
/** How long a community's one-request session stays open after its request. */
const PROXY_LINGER_MS = 75_000
/**
 * How long the busy account has been connected when its app opens: long enough that every group
 * has probed and the communities' sessions have built up, so the path screen sees an account that
 * has been running a while rather than one that started this second.
 */
const BUSY_WARM_MS = 15 * 60_000

const BUSY_SPECS: readonly FakePathSpec[] = [
  { remoteHex: hex64(0x51), destination: 'ownSwarm', everyMs: PROBE_EVERY_MS, rebuildMs: 600_000, proxied: false },
  { remoteHex: hex64(0x55), destination: 'fileServer', everyMs: FILE_EVERY_MS, rebuildMs: 720_000, proxied: false },
  ...Array.from({ length: BUSY_GROUPS }, (_, i): FakePathSpec => ({
    remoteHex: hex64(0x2000 + i),
    destination: 'storageNode',
    everyMs: PROBE_EVERY_MS,
    rebuildMs: 420_000 + i * 9_000,
    proxied: false,
  })),
] // prettier-ignore

/** A current path's totals, with how long ago the last request went where there was one. */
function withRequests(path: NetworkPath, requestsSent: number, sinceMs: number): NetworkPath {
  const { msSinceLastRequest: _, ...rest } = path
  return requestsSent > 0
    ? { ...rest, requestsSent, msSinceLastRequest: sinceMs }
    : { ...rest, requestsSent }
}

/** Its two paths, for a spec whose requests are spread through the period by its place in line. */
function busyPair(spec: FakePathSpec, index: number, elapsedMs: number): NetworkPath[] {
  // Staggered, as the legacy client's pollers were: not every group probed in the same second.
  const phase = (index * spec.everyMs) / (BUSY_GROUPS + 2)
  return [false, true].map((standby) => {
    const path = pathOf(spec, index, elapsedMs, standby)
    return standby
      ? path
      : withRequests(
          path,
          Math.floor((elapsedMs + phase) / spec.everyMs),
          (elapsedMs + phase) % spec.everyMs,
        )
  })
}

/** A community poll's session: one request through a fresh node, and its spare. */
function proxySessions(elapsedMs: number): NetworkPath[] {
  const out: NetworkPath[] = []
  COMMUNITY_POLL_MS.forEach((everyMs, community) => {
    const last = Math.floor(elapsedMs / everyMs)
    const first = Math.max(0, Math.ceil((elapsedMs - PROXY_LINGER_MS) / everyMs))
    for (let poll = first; poll <= last; poll += 1) {
      const openedMs = poll * everyMs
      const seed = 0x3000 + community * 0x800 + (poll % 0x800)
      for (const standby of [false, true]) {
        const base = seed * 5 + (standby ? 3 : 0)
        out.push({
          remoteHex: hex64(seed),
          destination: 'storageNode',
          standby,
          hops: hopsFor(base, 4),
          latencyMs: 180 + ((base * 37) % 260),
          jitterMs: 4 + ((base * 11) % 30),
          requestsSent: standby ? 0 : 1,
          proxiedRequestsSent: standby ? 0 : 1,
          ...(standby ? {} : { msSinceLastRequest: elapsedMs - openedMs }),
          pingsAnswered: Math.floor((elapsedMs - openedMs) / PING_EVERY_MS),
        })
      }
    }
  })
  return out
}

/**
 * Onion requests' paths, which are built before any destination is chosen: two for file transfers
 * and two for everything else, as libsession keeps by default, and two more for everything else on
 * the busy account, whose requests in flight at once outnumber two paths. Three hops each, no
 * pings, a round trip only where it is not a file path, no jitter, and replaced every ten minutes
 * under a new name, their counts starting again; staggered, so they are not all replaced at once.
 */
const ONION_ROTATION_MS = 600_000

interface FakeOnionSpec {
  destination: 'anyNode' | 'anyFile'
  everyMs: number
}

const ONION_SPECS: readonly FakeOnionSpec[] = [
  { destination: 'anyNode', everyMs: 3_000 },
  { destination: 'anyNode', everyMs: 4_000 },
  { destination: 'anyFile', everyMs: 41_000 },
  { destination: 'anyFile', everyMs: 67_000 },
]

const BUSY_ONION_SPECS: readonly FakeOnionSpec[] = [
  ...ONION_SPECS,
  { destination: 'anyNode', everyMs: 2_000 },
  { destination: 'anyNode', everyMs: 2_500 },
]

function onionPaths(elapsedMs: number, traffic: FakePathTraffic): NetworkPath[] {
  const specs = traffic === 'busy' ? BUSY_ONION_SPECS : ONION_SPECS
  return specs.map((spec, index) => {
    const offsetMs = (index * ONION_ROTATION_MS) / specs.length
    const build = Math.floor((elapsedMs + offsetMs) / ONION_ROTATION_MS)
    const sinceBuildMs = (elapsedMs + offsetMs) % ONION_ROTATION_MS
    const base = 0x700 + index * 7 + build * 13
    const requestsSent = Math.floor(sinceBuildMs / spec.everyMs)
    const prefix = spec.destination === 'anyFile' ? 'FP' : 'SP'
    return {
      remoteHex: `${prefix}-${index}-${build}`,
      destination: spec.destination,
      standby: false,
      hops: hopsFor(base, 3),
      // Timed from requests, file transfers left out, and no jitter, as libsession reports them.
      latencyMs: spec.destination === 'anyFile' ? 0 : 380 + ((base * 37) % 420),
      jitterMs: 0,
      requestsSent,
      proxiedRequestsSent: 0,
      ...(requestsSent > 0 ? { msSinceLastRequest: sinceBuildMs % spec.everyMs } : {}),
      pingsAnswered: 0,
    }
  })
}

/**
 * The snapshot for a network connected `elapsedMs` ago, or none where `elapsedMs` is null, as
 * `router` builds paths: sending direct, it has none.
 */
export function fakeNetworkPaths(
  elapsedMs: number | null,
  traffic: FakePathTraffic = 'quiet',
  router: RouterKind = 'session-router',
): NetworkPaths {
  if (elapsedMs === null) return { paths: [], nodesByCountry: [], countryAttribution: ATTRIBUTION }
  const nodesByCountry = [...NODES_BY_COUNTRY]
  if (router === 'direct') return { paths: [], nodesByCountry, countryAttribution: ATTRIBUTION }
  if (router === 'onion-requests') {
    const warmMs = traffic === 'busy' ? elapsedMs + BUSY_WARM_MS : elapsedMs
    return { paths: onionPaths(warmMs, traffic), nodesByCountry, countryAttribution: ATTRIBUTION }
  }
  if (traffic === 'busy') {
    const warmMs = elapsedMs + BUSY_WARM_MS
    return {
      paths: [
        ...BUSY_SPECS.flatMap((spec, index) => busyPair(spec, index, warmMs)),
        ...proxySessions(warmMs),
      ],
      nodesByCountry,
      countryAttribution: ATTRIBUTION,
    }
  }
  return {
    paths: SPECS.flatMap((spec, index) => [
      pathOf(spec, index, elapsedMs, false),
      pathOf(spec, index, elapsedMs, true),
    ]),
    nodesByCountry,
    countryAttribution: ATTRIBUTION,
  }
}
