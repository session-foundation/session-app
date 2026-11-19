/**
 * Where the country flow puts everything: pure geometry, so it can be tested and reused by the
 * drawing on both platforms.
 *
 * Five columns: you, the entry relay, two more relays, and the destination. Each column holds a bar
 * per country, as tall as the drawn paths that pass through that country at that column, and each
 * path takes a slot in each bar it passes through, so its line can be followed across.
 */

/** A path as the flow draws it: one country per column after "you", or null where unknown. */
export interface FlowPathInput {
  key: string
  countries: readonly (string | null)[]
}

interface FlowBar {
  column: number
  /** The country code, `?` where unknown. */
  country: string
  /** How many drawn paths pass through it. */
  count: number
  y: number
  height: number
}

export interface FlowLayout {
  /** The drawing's width, which the last column's labels run up to. */
  width: number
  columnX: readonly number[]
  barWidth: number
  bars: FlowBar[]
  /** Each path's point in every column, "you" first. */
  points: ReadonlyMap<string, readonly (readonly [number, number])[]>
}

const FLOW_COLUMNS = 5
const BAR_WIDTH = 5
/** The drawing's margin at both sides, outside your bar and the destination's alike. */
export const FLOW_SIDE = 14
/** Below the column titles. */
const TOP = 40
const BOTTOM = 14
/**
 * The most height one path is given in a bar, so a few paths sit together in the middle of the
 * drawing rather than each taking a third of the column.
 */
const MAX_UNIT = 12
const MAX_GAP = 10
const MIN_GAP = 2

function rankOf(country: string, order: readonly string[]): number {
  // The file server and unknown countries after every real one.
  if (country === 'FS') return 2_000
  if (country === '?') return 1_000
  const i = order.indexOf(country)
  return i === -1 ? order.length : i
}

function byRank(a: string, b: string, order: readonly string[]): number {
  return rankOf(a, order) - rankOf(b, order) || (a < b ? -1 : a > b ? 1 : 0)
}

/** How tall the drawing is at a width: a band for a few paths, nearly square for many. */
export function pathFlowHeight(width: number, pathCount: number): number {
  return Math.round(width * (pathCount <= 6 ? 0.5 : 0.95))
}

/**
 * Your bar and the destination's sit at the margins, and the relays' evenly between them. Every
 * column orders its bars by `countryOrder`, the network's countries by how many nodes they hold,
 * rather than by its own counts, so a country sits at the same height across the drawing and a
 * line between two of them runs level. Countries not in it follow by code.
 */
export function layoutPathFlow(
  paths: readonly FlowPathInput[],
  width: number,
  height: number,
  countryOrder: readonly string[] = [],
): FlowLayout {
  const lastX = width - FLOW_SIDE - BAR_WIDTH
  const step = Math.max(0, lastX - FLOW_SIDE) / (FLOW_COLUMNS - 1)
  const columnX = Array.from({ length: FLOW_COLUMNS }, (_, k) => FLOW_SIDE + k * step)
  const avail = Math.max(1, height - TOP - BOTTOM)
  const points = new Map<string, Array<readonly [number, number]>>()
  for (const p of paths) points.set(p.key, [])

  const columns: [string, FlowPathInput[]][][] = []
  columns.push([['you', [...paths]]])
  for (let column = 1; column < FLOW_COLUMNS; column += 1) {
    const groups = new Map<string, FlowPathInput[]>()
    for (const p of paths) {
      const cc = p.countries[column - 1] ?? '?'
      const list = groups.get(cc)
      if (list) list.push(p)
      else groups.set(cc, [p])
    }
    columns.push([...groups.entries()].sort((a, b) => byRank(a[0], b[0], countryOrder)))
  }

  // Gaps shrink as countries multiply, so they never take the height the paths need.
  const mostBars = Math.max(...columns.map((c) => c.length))
  const gap = Math.max(MIN_GAP, Math.min(MAX_GAP, (avail * 0.3) / Math.max(1, mostBars - 1)))
  const unit =
    paths.length === 0
      ? 0
      : Math.min(
          MAX_UNIT,
          ...columns.map((c) => Math.max(0, avail - (c.length - 1) * gap) / paths.length),
        )

  const bars: FlowBar[] = []
  columns.forEach((groups, column) => {
    const columnHeight = paths.length * unit + (groups.length - 1) * gap
    let y = TOP + (avail - columnHeight) / 2
    for (const [country, members] of groups) {
      const h = members.length * unit
      bars.push({ column, country, count: members.length, y, height: h })
      // Within a bar, paths keep the order they had in the previous column, so lines cross less.
      const previous = (p: FlowPathInput) => points.get(p.key)?.[column - 1]?.[1] ?? 0
      const sorted = column === 0 ? members : [...members].sort((a, b) => previous(a) - previous(b))
      sorted.forEach((p, i) => {
        points.get(p.key)?.push([columnX[column] ?? 0, y + (i + 0.5) * unit])
      })
      y += h + gap
    }
  })
  return { width, columnX, barWidth: BAR_WIDTH, bars, points }
}

/** A number in [0, 1) that depends only on `key` and `salt`: FNV-1a. */
export function hashUnit(key: string, salt: number): number {
  let h = 0x811c9dc5 ^ salt
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) / 0x1_0000_0000
}

/**
 * Where a path missing from `layout` goes without moving anything already there: in each column, a
 * slot in the bar of the country it crosses, picked by its key. Null when a column has no bar for
 * its country: it waits for the next layout.
 */
export function placeInLayout(
  layout: FlowLayout,
  path: FlowPathInput,
): (readonly [number, number])[] | null {
  const pts: (readonly [number, number])[] = []
  for (let column = 0; column < FLOW_COLUMNS; column += 1) {
    const country = column === 0 ? 'you' : (path.countries[column - 1] ?? '?')
    const bar = layout.bars.find((b) => b.column === column && b.country === country)
    if (!bar) return null
    const inset = Math.min(1.5, bar.height / 4)
    const y = bar.y + inset + hashUnit(path.key, column) * Math.max(0, bar.height - 2 * inset)
    pts.push([layout.columnX[column] ?? 0, y])
  }
  return pts
}

/**
 * The cubic between two columns' points, from the right edge of one bar to the left edge of the
 * next, which every line follows.
 */
export function flowSegment(
  a: readonly [number, number],
  b: readonly [number, number],
  barWidth: number,
): [number, number, number, number, number, number, number, number] {
  const ax = a[0] + barWidth
  const mx = (ax + b[0]) / 2
  return [ax, a[1], mx, a[1], mx, b[1], b[0], b[1]]
}

function cubicAt([x0, y0, x1, y1, x2, y2, x3, y3]: readonly number[], t: number): [number, number] {
  const u = 1 - t
  const a = u * u * u
  const b = 3 * u * u * t
  const c = 3 * u * t * t
  const d = t * t * t
  return [
    a * (x0 ?? 0) + b * (x1 ?? 0) + c * (x2 ?? 0) + d * (x3 ?? 0),
    a * (y0 ?? 0) + b * (y1 ?? 0) + c * (y2 ?? 0) + d * (y3 ?? 0),
  ]
}

/**
 * A point on a path, `h` hops along it (0 at you, 4 at the destination). A whole `h` is the middle
 * of that column's bar, where a request stops: it crosses half the bar, follows the line, then
 * crosses half the next.
 */
export function pointAlong(
  pts: readonly (readonly [number, number])[],
  h: number,
  barWidth: number,
): [number, number] {
  const last = pts.length - 1
  const clamped = Math.min(Math.max(h, 0), last)
  const i = Math.min(Math.floor(clamped), last - 1)
  const t = clamped - i
  const a = pts[i]
  const b = pts[i + 1]
  if (!a || !b) return [(pts[0]?.[0] ?? 0) + barWidth / 2, pts[0]?.[1] ?? 0]
  const half = barWidth / 2
  const span = Math.max(1, b[0] - a[0])
  const d = t * span
  if (d <= half) return [a[0] + half + d, a[1]]
  if (d >= span - half) return [b[0] + d - (span - half), b[1]]
  return cubicAt(flowSegment(a, b, barWidth), (d - half) / Math.max(1, span - barWidth))
}
