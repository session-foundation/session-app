import type { ConversationKind, NetworkPath, NetworkPaths } from '@session/client'

/**
 * What the path screen makes of the snapshots it polls: which paths are in use, which requests
 * and pings set off since the last look, how often paths were rebuilt, and the figures in its
 * stats.
 *
 * libsession reports totals rather than events, so a request is "seen" when a remote's total has
 * gone up since the last snapshot that had it. When is known to within one poll, which is why the
 * requests found in one are spread across the interval rather than all starting together.
 */

/** A path counts as in use for this long after its last request. */
export const IN_USE_MS = 60_000

/** More than this many requests in one poll are drawn as this many: a burst, not a queue. */
const MAX_PER_POLL = 4

/**
 * Pings are drawn only where they are the only thing happening: not on a path that carried a
 * request this recently, and while this many requests went anywhere in that time, only on your
 * own swarm's paths.
 */
const PING_QUIET_MS = 5_000
export const BUSY_REQUESTS = 4

/**
 * A poll this much later than the last one means the screen was not being drawn (a window in the
 * background, whose timers the system slows): what changed meanwhile is not traffic to animate.
 */
const STALE_POLLS = 3

export type PathKind = 'swarm' | 'node' | 'community' | 'file'

/**
 * The destination column of a path built before any destination is chosen, under onion requests:
 * one bar they all share, unlabelled, since each request names its own.
 */
export const ANY_DESTINATION = '*'

export interface TrackedPath {
  /** The remote for its current path; the remote and a number for a standby one. */
  key: string
  /** The remote, which its current and standby paths share. */
  sessionKey: string
  /** Held ready to switch to, carrying nothing but pings. */
  standby: boolean
  /**
   * Built before any destination is chosen, under onion requests, and kept whether or not it is
   * used: every one is drawn, there being only a handful.
   */
  anyDestination: boolean
  kind: PathKind
  /**
   * A country per column after "you": entry, relay, relay, destination (`FS` the file server,
   * `ANY_DESTINATION` an onion request's).
   */
  countries: (string | null)[]
  entryHex: string | null
  latencyMs: number
  jitterMs: number
  /** When it last carried a request, or null if not since the screen opened. */
  lastRequestAtMs: number | null
}

/** A request the client sent, or one of the router's pings, which say only that a path is alive. */
type SeenKind = 'request' | 'ping'

export interface SeenRequest {
  id: string
  pathKey: string
  atMs: number
  kind: SeenKind
}

export interface PathTracker {
  paths: TrackedPath[]
  totals: ReadonlyMap<string, number>
  pingTotals: ReadonlyMap<string, number>
  hopSignatures: ReadonlyMap<string, string>
  /** When each request of the last `PING_QUIET_MS` was seen, oldest first. */
  recentRequestsMs: readonly number[]
  rebuilt: number
  attribution: string
  /**
   * The network's countries, most nodes first, from the first snapshot that had them: kept while
   * the screen is open, so the bars are never reordered under the reader.
   */
  countryOrder: readonly string[]
  /** How many requests and pings have been seen, for ids. */
  seq: number
  /** When the last snapshot was taken, or null before the first. */
  lastPollMs: number | null
}

export const EMPTY_TRACKER: PathTracker = {
  paths: [],
  totals: new Map(),
  pingTotals: new Map(),
  hopSignatures: new Map(),
  recentRequestsMs: [],
  rebuilt: 0,
  attribution: '',
  countryOrder: [],
  seq: 0,
  lastPollMs: null,
}

function isAnyDestination(path: NetworkPath): boolean {
  return path.destination === 'anyNode' || path.destination === 'anyFile'
}

function kindOf(path: NetworkPath): PathKind {
  if (path.destination === 'fileServer' || path.destination === 'anyFile') return 'file'
  // An onion path carries your swarm's requests along with everyone else's.
  if (path.destination === 'ownSwarm' || path.destination === 'anyNode') return 'swarm'
  // A node a community request went through: it proxies to the server, which is what it is for.
  return path.proxiedRequestsSent > 0 ? 'community' : 'node'
}

function countriesOf(path: NetworkPath): (string | null)[] {
  const hops = path.hops.map((hop) => hop.country ?? null)
  // The file server lies past the last relay we can see; its column is the server itself.
  if (path.destination === 'fileServer') return [...hops.slice(0, 3), 'FS']
  if (isAnyDestination(path)) return [...hops.slice(0, 3), ANY_DESTINATION]
  return hops.slice(0, 4)
}

/** Your own swarm first, then the file server, then the rest in a fixed order so lines stay put. */
const KIND_ORDER: Record<PathKind, number> = { swarm: 0, file: 1, community: 2, node: 3 }

/**
 * Folds one snapshot into the tracker. The first snapshot sets the baseline: totals from before
 * the screen opened say nothing of when, so they neither draw requests nor put a path in use, and
 * the screen opens on the paths that are always shown. A rebuilt path's ping count starts again,
 * so it is a new baseline rather than pings seen.
 */
export function trackSnapshot(
  tracker: PathTracker,
  snapshot: NetworkPaths,
  nowMs: number,
  pollMs: number,
): { tracker: PathTracker; requests: SeenRequest[] } {
  // The first snapshot, or the first after a gap, is a baseline: what the totals moved by since
  // is not drawn as requests or pings, though when each remote last had one still says what is
  // in use.
  const first = tracker.lastPollMs === null || nowMs - tracker.lastPollMs > STALE_POLLS * pollMs
  const previous = new Map(tracker.paths.map((p) => [p.key, p]))
  // Kept for remotes missing from this snapshot: a remote's count never resets, so one that comes
  // back, between builds or with a new session, is compared with where it left off.
  const totals = new Map(tracker.totals)
  const pingTotals = new Map<string, number>()
  const hopSignatures = new Map<string, string>()
  const requests: SeenRequest[] = []
  const pinged: { key: string; kind: PathKind; lastRequestAtMs: number | null }[] = []
  let rebuilt = tracker.rebuilt
  let seq = tracker.seq

  // A standby path is the same kind as its session's current one, which alone carries requests.
  const sessionKinds = new Map(
    snapshot.paths.filter((p) => !p.standby).map((p) => [p.remoteHex, kindOf(p)]),
  )
  const kindFor = (path: NetworkPath) =>
    sessionKinds.get(path.remoteHex) ?? (path.standby ? 'node' : kindOf(path))
  const ordered = [...snapshot.paths].sort(
    (a, b) =>
      KIND_ORDER[kindFor(a)] - KIND_ORDER[kindFor(b)] ||
      (a.remoteHex < b.remoteHex ? -1 : a.remoteHex > b.remoteHex ? 1 : 0) ||
      Number(a.standby) - Number(b.standby),
  )
  // Every route each remote had last time, so a path that moves from standby to current is not
  // taken for a new one; a route the remote has not had before is a build.
  const routesBefore = new Map<string, Set<string>>()
  for (const p of tracker.paths) {
    const sig = tracker.hopSignatures.get(p.key)
    if (sig === undefined) continue
    const set = routesBefore.get(p.sessionKey) ?? new Set<string>()
    set.add(sig)
    routesBefore.set(p.sessionKey, set)
  }
  const standbyCount = new Map<string, number>()
  const paths = ordered.map((path): TrackedPath => {
    let key = path.remoteHex
    if (path.standby) {
      const n = (standbyCount.get(path.remoteHex) ?? 0) + 1
      standbyCount.set(path.remoteHex, n)
      key = `${path.remoteHex}~${n}`
    }
    const signature = path.hops.map((hop) => hop.pubkeyHex).join(',')
    const before = tracker.hopSignatures.get(key)
    const replaced = before !== undefined && before !== signature
    const routes = routesBefore.get(path.remoteHex)
    if (!first && routes !== undefined && !routes.has(signature)) rebuilt += 1
    // An onion path has no remote to keep: its replacement comes under a name not seen before.
    if (!first && isAnyDestination(path) && !previous.has(key)) rebuilt += 1
    hopSignatures.set(key, signature)

    totals.set(key, path.requestsSent)
    pingTotals.set(key, path.pingsAnswered)
    const was = tracker.totals.get(key)
    let lastRequestAtMs =
      path.msSinceLastRequest === undefined
        ? (previous.get(key)?.lastRequestAtMs ?? null)
        : nowMs - path.msSinceLastRequest
    if (!first) {
      // A remote not seen since the screen opened brings a total from before it: a baseline, as
      // the first snapshot's are, with one request drawn only if its last went during this poll.
      const added =
        was !== undefined
          ? path.requestsSent - was
          : path.msSinceLastRequest !== undefined && path.msSinceLastRequest < pollMs
            ? 1
            : 0
      if (added > 0) {
        const shown = Math.min(added, MAX_PER_POLL)
        for (let i = 0; i < shown; i += 1) {
          seq += 1
          requests.push({
            id: `r${seq}`,
            pathKey: key,
            atMs: nowMs + (pollMs * i) / shown,
            kind: 'request',
          })
        }
        lastRequestAtMs = nowMs
      }
      const pingsWere = tracker.pingTotals.get(key)
      if (!replaced && pingsWere !== undefined && path.pingsAnswered > pingsWere)
        pinged.push({ key, kind: kindFor(path), lastRequestAtMs })
    }

    return {
      key,
      sessionKey: path.remoteHex,
      standby: path.standby,
      anyDestination: isAnyDestination(path),
      kind: kindFor(path),
      countries: countriesOf(path),
      entryHex: path.hops[0]?.pubkeyHex ?? null,
      latencyMs: path.latencyMs,
      jitterMs: path.jitterMs,
      lastRequestAtMs,
    }
  })

  const recentRequestsMs = [
    ...tracker.recentRequestsMs.filter((at) => nowMs - at < PING_QUIET_MS),
    ...requests.map((r) => r.atMs),
  ]
  const quiet = pinged.filter(
    ({ lastRequestAtMs }) => lastRequestAtMs === null || nowMs - lastRequestAtMs >= PING_QUIET_MS,
  )
  // Busy, your own swarm's pings still show: they are what says your messages can reach you.
  // What went out since the screen opened, or what libsession says went out lately, whichever is
  // more: just after opening, the first counts nothing yet.
  const recentlyUsed = paths.filter(
    (p) => !p.standby && p.lastRequestAtMs !== null && nowMs - p.lastRequestAtMs < PING_QUIET_MS,
  ).length
  const busy = Math.max(recentlyUsed, recentRequestsMs.length) >= BUSY_REQUESTS
  const shownPings = busy ? quiet.filter((p) => p.kind === 'swarm') : quiet
  for (const { key } of shownPings) {
    seq += 1
    // Half a poll in, so a ping never sets off in step with the requests found beside it.
    requests.push({ id: `p${seq}`, pathKey: key, atMs: nowMs + pollMs / 2, kind: 'ping' })
  }

  return {
    tracker: {
      paths,
      totals,
      pingTotals,
      hopSignatures,
      recentRequestsMs,
      rebuilt,
      attribution: snapshot.countryAttribution,
      countryOrder:
        tracker.countryOrder.length > 0
          ? tracker.countryOrder
          : snapshot.nodesByCountry.map((c) => c.country),
      seq,
      lastPollMs: nowMs,
    },
    requests,
  }
}

/**
 * The paths in use: those of any session that carried a request in the last minute, standby ones
 * included, and always the paths to your own swarm and to the file server, which the client keeps
 * for as long as it holds them open, and every onion path.
 */
export function inUse(tracker: PathTracker, nowMs: number): TrackedPath[] {
  const busy = new Set(
    tracker.paths
      .filter((p) => p.lastRequestAtMs !== null && nowMs - p.lastRequestAtMs < IN_USE_MS)
      .map((p) => p.sessionKey),
  )
  // Your swarm has several members and the client may have talked to more than one of them; the
  // one it talked to last is always drawn, and any other only while in use, like any node.
  const swarm = tracker.paths
    .filter((p) => p.kind === 'swarm' && !p.standby && !p.anyDestination)
    .reduce<TrackedPath | null>(
      (best, p) =>
        best === null || (p.lastRequestAtMs ?? -Infinity) > (best.lastRequestAtMs ?? -Infinity)
          ? p
          : best,
      null,
    )
  return tracker.paths.filter(
    (p) =>
      p.anyDestination ||
      p.sessionKey === swarm?.sessionKey ||
      p.kind === 'file' ||
      busy.has(p.sessionKey),
  )
}

export interface PathStats {
  /**
   * Every path in use is an onion request's: the timings are how long requests took to be answered
   * rather than a path's round trip, and there is no jitter to give.
   */
  onionRequests: boolean
  pathsInUse: number
  countriesCrossed: number
  entryNodes: number
  rebuilt: number
  /** Null until some path in use has answered a ping, or under onion requests a request. */
  averageMs: number | null
  fastestMs: number | null
  slowestMs: number | null
  jitterMs: number | null
}

export function pathStats(tracker: PathTracker, nowMs: number): PathStats {
  const used = inUse(tracker, nowMs)
  const countries = new Set<string>()
  for (const p of used)
    for (const cc of p.countries)
      if (cc !== null && cc !== 'FS' && cc !== ANY_DESTINATION) countries.add(cc)
  // The paths drawn: a count over every open path would name entry nodes no line on screen uses.
  const entries = new Set(used.map((p) => p.entryHex).filter((e) => e !== null))
  const timed = used.filter((p) => p.latencyMs > 0)
  const latencies = timed.map((p) => p.latencyMs)
  const mean = (xs: number[]) =>
    xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length
  const onionRequests = used.length > 0 && used.every((p) => p.anyDestination)
  return {
    onionRequests,
    pathsInUse: used.length,
    countriesCrossed: countries.size,
    entryNodes: entries.size,
    rebuilt: tracker.rebuilt,
    averageMs: mean(latencies),
    fastestMs: latencies.length === 0 ? null : Math.min(...latencies),
    slowestMs: latencies.length === 0 ? null : Math.max(...latencies),
    jitterMs: onionRequests ? null : mean(timed.map((p) => p.jitterMs)),
  }
}

/** A session's paths: its current one, and the spare the router keeps beside it. */
const PATHS_PER_SESSION = 2

/**
 * How many paths the account will have in use, guessed from its conversations before a snapshot
 * says, so the drawing can open at the height it will need: your swarm's session always, and one
 * for each conversation that keeps a session of its own open. One-to-one chats do not: a message
 * to a contact uses a session only while it is sent.
 */
export function expectedPathCount(conversations: readonly { kind: ConversationKind }[]): number {
  // Unread until the client has groups or communities; the terms below are what reads it.
  void conversations
  const sessions =
    // Your swarm.
    1
  // TODO: a group's swarm is subscribed to as yours is, so each group holds a session open. Count
  // them once the client has groups:
  //   + conversations.filter((c) => c.kind === 'group').length
  // TODO: a community is polled every few seconds, each poll through a node no other request is
  // using, so a minute holds about a dozen of its sessions. Count them once the client has
  // communities:
  //   + conversations.filter((c) => c.kind === 'community').length * 12
  return sessions * PATHS_PER_SESSION
}

/**
 * How long one link takes on screen, from the path's measured round trip: real round trips are
 * 150-600 ms, too quick to follow, so they are slowed by a fixed factor that keeps a slow path
 * visibly slower than a fast one, and clamped so neither is a blur nor a crawl.
 */
const SLOWDOWN = 6
const MIN_HOP_MS = 140
const MAX_HOP_MS = 700
const UNTIMED_HOP_MS = 320

export function hopMsFor(latencyMs: number): number {
  if (latencyMs <= 0) return UNTIMED_HOP_MS
  // A round trip crosses each of the four links twice.
  return Math.min(MAX_HOP_MS, Math.max(MIN_HOP_MS, (latencyMs * SLOWDOWN) / 8))
}
