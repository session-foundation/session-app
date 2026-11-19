/**
 * How a request moves along its path, as onion routing under Session Router has it: it leaves
 * wrapped once per link and each node takes off its own layer, so only the destination reads it;
 * the answer leaves wrapped once, each node on the way back adds one, and the device takes them
 * all off. The request pauses at every node while that happens.
 *
 * Pure timing, so where a request is can be worked out from the clock alone, on any frame.
 */

/** A node taking off its layer, or putting one on, before the request moves on. */
export const NODE_HOLD_MS = 160
/** The destination reading the request bare, before it wraps the answer. */
const READ_MS = 170
/** How long a ring is drawn round a node as a layer comes off or goes on. */
export const RING_MS = 300
/** After the answer is wrapped, before it sets off: the ring can be seen closing first. */
const SETTLE_MS = 140

/** What happens to a layer at a node: off on the way out, on on the way back, all off at home. */
type RingKind = 'peel' | 'wrap' | 'open'

export interface JourneyRing {
  atMs: number
  hop: number
  kind: RingKind
}

interface Leg {
  startMs: number
  endMs: number
  fromHop: number
  toHop: number
  layers: number
  /** On a pause, the layer put on partway through: the destination wrapping its answer. */
  wrapAtMs?: number
}

export interface Journey {
  legs: readonly Leg[]
  rings: readonly JourneyRing[]
  totalMs: number
}

/**
 * How a trip is drawn: a request, stopping at every node while its layers come off and go on; a
 * ping, wrapped and unwrapped just the same but not stopping, and turning back at the path's last
 * relay, which is what answers it; or plain, out and back with no layers at all.
 */
export type JourneyStyle = 'request' | 'ping' | 'plain'

/**
 * The legs of one trip. `links` is how many layers a request leaves with: four to a storage node,
 * three to the file server, whose last column lies past the relay that reaches it.
 */
export function journeyOf(hopMs: number, links: number, style: JourneyStyle): Journey {
  const legs: Leg[] = []
  const rings: JourneyRing[] = []
  let t = 0
  const move = (fromHop: number, toHop: number, layers: number) => {
    legs.push({ startMs: t, endMs: t + hopMs, fromHop, toHop, layers })
    t += hopMs
  }
  const pause = (hop: number, ms: number, layers: number, wrapAtMs?: number) => {
    legs.push({
      startMs: t,
      endMs: t + ms,
      fromHop: hop,
      toHop: hop,
      layers,
      ...(wrapAtMs === undefined ? {} : { wrapAtMs }),
    })
    t += ms
  }

  if (style === 'plain') {
    for (let n = 1; n <= 4; n += 1) move(n - 1, n, 0)
    for (let n = 3; n >= 0; n -= 1) move(n + 1, n, 0)
    return { legs, rings, totalMs: t }
  }
  if (style === 'ping') {
    // A layer per relay out, the last relay reads it and answers wrapped once, and each relay on
    // the way back adds one more.
    for (let n = 1; n <= links; n += 1) move(n - 1, n, links - (n - 1))
    for (let n = links - 1; n >= 0; n -= 1) move(n + 1, n, links - n)
    return { legs, rings, totalMs: t }
  }

  for (let n = 1; n <= 4; n += 1) {
    move(n - 1, n, links - (n - 1))
    if (n < 4) {
      rings.push({ atMs: t, hop: n, kind: 'peel' })
      pause(n, NODE_HOLD_MS, links - n)
    } else if (links === 4) {
      rings.push({ atMs: t, hop: 4, kind: 'peel' })
      const wrapAtMs = t + NODE_HOLD_MS + READ_MS
      rings.push({ atMs: wrapAtMs, hop: 4, kind: 'wrap' })
      pause(4, NODE_HOLD_MS + READ_MS + SETTLE_MS, 0, wrapAtMs)
    } else {
      // The file server, past its last relay: it reads the request and answers bare.
      pause(4, READ_MS + SETTLE_MS, 0)
    }
  }
  for (let n = 3; n >= 0; n -= 1) {
    // Back between n + 1 and n, carrying a layer for each node already passed.
    move(n + 1, n, Math.max(0, links - n))
    if (n === 0) {
      rings.push({ atMs: t, hop: 0, kind: 'open' })
    } else {
      rings.push({ atMs: t, hop: n, kind: 'wrap' })
      pause(n, NODE_HOLD_MS, links + 1 - n)
    }
  }
  return { legs, rings, totalMs: t }
}

export interface JourneyState {
  /** Hops from you, 0 to 4. */
  h: number
  /** On the way back. */
  back: boolean
  /** Layers of encryption it carries right now. */
  layers: number
}

/** Where the request is `elapsedMs` into its trip, or null before it sets off or once home. */
export function journeyAt(journey: Journey, elapsedMs: number): JourneyState | null {
  if (elapsedMs < 0 || elapsedMs >= journey.totalMs) return null
  let back = false
  for (const leg of journey.legs) {
    if (leg.toHop < leg.fromHop) back = true
    if (elapsedMs >= leg.endMs) continue
    const f = (elapsedMs - leg.startMs) / (leg.endMs - leg.startMs)
    const layers =
      leg.wrapAtMs !== undefined && elapsedMs >= leg.wrapAtMs ? leg.layers + 1 : leg.layers
    return { h: leg.fromHop + (leg.toHop - leg.fromHop) * f, back, layers }
  }
  return null
}

/** The rings showing `elapsedMs` into the trip, each with how far through it is, 0 to 1. */
export function ringsAt(journey: Journey, elapsedMs: number): { ring: JourneyRing; age: number }[] {
  return journey.rings
    .filter((ring) => elapsedMs >= ring.atMs && elapsedMs < ring.atMs + RING_MS)
    .map((ring) => ({ ring, age: (elapsedMs - ring.atMs) / RING_MS }))
}

/**
 * A request that set off before its path was drawn starts from the beginning once it is, rather
 * than appearing part way along a line that was not there. `drawnAtMs` holds when each path was
 * first drawn: 0 for those drawn as the flow opened, whose requests under way join part way along.
 */
export function retime<T extends { pathKey: string; startMs: number }>(
  packets: readonly T[],
  drawnAtMs: ReadonlyMap<string, number>,
): readonly T[] {
  return packets.map((p) => {
    const atMs = drawnAtMs.get(p.pathKey) ?? 0
    return atMs > p.startMs ? { ...p, startMs: atMs } : p
  })
}
