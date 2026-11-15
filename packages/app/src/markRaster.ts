import type { MarkOutline } from '@session/basic-types'

/** A point in the outline's own units. */
type Point = readonly [number, number]

/** Straight segments a curve is drawn with: at a mark's size, more are not visible. */
const CURVE_SEGMENTS = 16
/** The most an arc turns per straight segment. */
const ARC_STEP_RADIANS = Math.PI / 16
/** Samples per pixel along each axis; a pixel is ink when at least half of them are. */
const SAMPLES = 4

const COMMAND = /[MmLlHhVvCcSsQqTtAaZz]/y
const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y
const SEPARATOR = /[\s,]*/y

/**
 * Reads SVG path data into a list of closed outlines. Every command a path can hold, relative and
 * absolute, arcs included, since an outline exported from a design tool uses most of them. Arc
 * flags are read as single digits: a minified path writes `0 01` as `001`.
 */
function parsePath(d: string): Point[][] {
  let at = 0
  const skip = () => {
    SEPARATOR.lastIndex = at
    SEPARATOR.exec(d)
    at = SEPARATOR.lastIndex
  }
  const number = (): number => {
    skip()
    NUMBER.lastIndex = at
    const match = NUMBER.exec(d)
    if (match === null) throw new Error(`a number at ${at} in the path`)
    at = NUMBER.lastIndex
    return Number(match[0])
  }
  const flag = (): number => {
    skip()
    const digit = d[at]
    if (digit !== '0' && digit !== '1') throw new Error(`an arc flag at ${at} in the path`)
    at += 1
    return digit === '1' ? 1 : 0
  }
  const outlines: Point[][] = []
  let outline: Point[] = []
  let x = 0
  let y = 0
  let startX = 0
  let startY = 0
  // The last control point, for S and T, which reflect it; reset by any other command.
  let control: Point | null = null
  let command = ''

  const close = () => {
    if (outline.length > 1) outlines.push(outline)
    outline = []
  }
  const lineTo = (nx: number, ny: number) => {
    x = nx
    y = ny
    outline.push([x, y])
  }
  const cubic = (c1: Point, c2: Point, end: Point) => {
    const [x0, y0] = [x, y]
    for (let i = 1; i <= CURVE_SEGMENTS; i += 1) {
      const t = i / CURVE_SEGMENTS
      const u = 1 - t
      outline.push([
        u * u * u * x0 + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * end[0],
        u * u * u * y0 + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * end[1],
      ])
    }
    ;[x, y] = end
  }
  const quadratic = (c: Point, end: Point) => {
    // Raised to a cubic, which draws the same curve.
    cubic(
      [x + (2 / 3) * (c[0] - x), y + (2 / 3) * (c[1] - y)],
      [end[0] + (2 / 3) * (c[0] - end[0]), end[1] + (2 / 3) * (c[1] - end[1])],
      end,
    )
  }

  for (;;) {
    skip()
    if (at >= d.length) break
    COMMAND.lastIndex = at
    const letter = COMMAND.exec(d)
    if (letter !== null) {
      command = letter[0]
      at = COMMAND.lastIndex
    } else if (command === '' || command === 'Z' || command === 'z') {
      throw new Error(`a command at ${at} in the path`)
    }
    // A number where a command was expected repeats the last one; after a move it draws lines.
    else if (command === 'M') command = 'L'
    else if (command === 'm') command = 'l'

    const relative = command === command.toLowerCase()
    const ox = relative ? x : 0
    const oy = relative ? y : 0
    const upper = command.toUpperCase()
    const lastControl = control
    control = null

    switch (upper) {
      case 'M': {
        close()
        x = ox + number()
        y = oy + number()
        startX = x
        startY = y
        outline.push([x, y])
        break
      }
      case 'L':
        lineTo(ox + number(), oy + number())
        break
      case 'H':
        lineTo(ox + number(), y)
        break
      case 'V':
        lineTo(x, oy + number())
        break
      case 'C': {
        const c1: Point = [ox + number(), oy + number()]
        const c2: Point = [ox + number(), oy + number()]
        const end: Point = [ox + number(), oy + number()]
        cubic(c1, c2, end)
        control = c2
        break
      }
      case 'S': {
        const c1: Point =
          lastControl === null ? [x, y] : [2 * x - lastControl[0], 2 * y - lastControl[1]]
        const c2: Point = [ox + number(), oy + number()]
        const end: Point = [ox + number(), oy + number()]
        cubic(c1, c2, end)
        control = c2
        break
      }
      case 'Q': {
        const c: Point = [ox + number(), oy + number()]
        quadratic(c, [ox + number(), oy + number()])
        control = c
        break
      }
      case 'T': {
        const c: Point =
          lastControl === null ? [x, y] : [2 * x - lastControl[0], 2 * y - lastControl[1]]
        quadratic(c, [ox + number(), oy + number()])
        control = c
        break
      }
      case 'A': {
        const rx = number()
        const ry = number()
        const rotation = number()
        const large = flag()
        const sweep = flag()
        arcTo(outline, [x, y], rx, ry, rotation, large, sweep, [ox + number(), oy + number()])
        ;[x, y] = outline[outline.length - 1] ?? [x, y]
        break
      }
      case 'Z':
        x = startX
        y = startY
        close()
        // A drawing command straight after a close starts from where the outline began.
        outline.push([x, y])
        break
      default:
        throw new Error(`the path command ${command}`)
    }
  }
  close()
  return outlines
}

/** Appends an elliptical arc as points, its endpoint form converted to centre form (SVG F.6.5). */
function arcTo(
  out: Point[],
  from: Point,
  rxIn: number,
  ryIn: number,
  rotationDegrees: number,
  large: number,
  sweep: number,
  to: Point,
): void {
  let rx = Math.abs(rxIn)
  let ry = Math.abs(ryIn)
  if (rx === 0 || ry === 0 || (from[0] === to[0] && from[1] === to[1])) {
    out.push(to)
    return
  }
  const phi = (rotationDegrees * Math.PI) / 180
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)
  const dx = (from[0] - to[0]) / 2
  const dy = (from[1] - to[1]) / 2
  const x1 = cos * dx + sin * dy
  const y1 = -sin * dx + cos * dy
  // Radii too small to reach are scaled up until they just do.
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
  if (lambda > 1) {
    rx *= Math.sqrt(lambda)
    ry *= Math.sqrt(lambda)
  }
  const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
  const denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1
  const factor = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, numerator / denominator))
  const cx1 = (factor * rx * y1) / ry
  const cy1 = (-factor * ry * x1) / rx
  const cx = cos * cx1 - sin * cy1 + (from[0] + to[0]) / 2
  const cy = sin * cx1 + cos * cy1 + (from[1] + to[1]) / 2
  const angle = (ux: number, uy: number, vx: number, vy: number) =>
    Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
  const start = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry)
  let delta = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry)
  if (sweep === 0 && delta > 0) delta -= 2 * Math.PI
  if (sweep === 1 && delta < 0) delta += 2 * Math.PI
  const steps = Math.max(1, Math.ceil(Math.abs(delta) / ARC_STEP_RADIANS))
  for (let i = 1; i <= steps; i += 1) {
    const t = start + (delta * i) / steps
    const ex = rx * Math.cos(t)
    const ey = ry * Math.sin(t)
    out.push(i === steps ? to : [cos * ex - sin * ey + cx, sin * ex + cos * ey + cy])
  }
}

/**
 * A mark drawn into a box of `widthPx` by `heightPx`, fitted and centred: one byte a pixel, 1 where
 * the mark is. Filled by the nonzero rule, as SVG fills a path that names no rule, so an outline's
 * holes are wherever its designer wound them the other way.
 */
export function rasterizeMark(mark: MarkOutline, widthPx: number, heightPx: number): Uint8Array {
  const scale = Math.min(widthPx / mark.width, heightPx / mark.height)
  const offsetX = (widthPx - mark.width * scale) / 2
  const offsetY = (heightPx - mark.height * scale) / 2
  const edges = parsePath(mark.path).flatMap((outline) =>
    outline.map((point, i): [Point, Point] => {
      const next = outline[(i + 1) % outline.length] ?? point
      return [
        [point[0] * scale + offsetX, point[1] * scale + offsetY],
        [next[0] * scale + offsetX, next[1] * scale + offsetY],
      ]
    }),
  )

  const covered = new Uint16Array(widthPx * heightPx)
  for (let row = 0; row < heightPx * SAMPLES; row += 1) {
    const sy = (row + 0.5) / SAMPLES
    const crossings: { x: number; winding: number }[] = []
    for (const [[x0, y0], [x1, y1]] of edges) {
      if (y0 <= sy && y1 > sy)
        crossings.push({ x: x0 + ((sy - y0) * (x1 - x0)) / (y1 - y0), winding: 1 })
      else if (y1 <= sy && y0 > sy)
        crossings.push({ x: x0 + ((sy - y0) * (x1 - x0)) / (y1 - y0), winding: -1 })
    }
    crossings.sort((a, b) => a.x - b.x)
    const py = Math.floor(sy)
    let winding = 0
    for (let i = 0; i < crossings.length - 1; i += 1) {
      const crossing = crossings[i]
      const next = crossings[i + 1]
      if (crossing === undefined || next === undefined) continue
      winding += crossing.winding
      if (winding === 0) continue
      // Every sample column whose centre falls inside this span.
      const first = Math.max(0, Math.ceil(crossing.x * SAMPLES - 0.5))
      const last = Math.min(widthPx * SAMPLES - 1, Math.floor(next.x * SAMPLES - 0.5))
      for (let column = first; column <= last; column += 1) {
        const at = py * widthPx + Math.floor(column / SAMPLES)
        covered[at] = (covered[at] ?? 0) + 1
      }
    }
  }

  const half = (SAMPLES * SAMPLES) / 2
  const ink = new Uint8Array(covered.length)
  covered.forEach((count, i) => {
    if (count >= half) ink[i] = 1
  })
  return ink
}
