import { useTokenColor } from './useTokenColor'
import Svg, { Circle } from 'react-native-svg'

/**
 * How much of the circle the ring occupies, in degrees.
 *
 * iOS trims its circle to `0.85` (306°) and Android sweeps `310f`; four degrees apart and
 * indistinguishable. The gap is the point: a ring with a piece missing reads as a gauge, where a
 * closed one reads as a spinner that has stopped.
 */
const SWEEP_DEGREES = 306

/**
 * Where the arc begins, derived rather than written down.
 *
 * Android computes `(360 - sweep)/2 + 90`, which centres the gap on six o'clock whatever the sweep
 * is; iOS hardcodes 117, which is the same number for its own sweep and would stop being right if
 * the sweep changed. Taking the derivation means the gap stays at the bottom either way.
 *
 * For a 306° sweep this is 117° — just left of bottom-centre. The fill then climbs the **left**
 * side, crosses the top and comes down the right, which is the direction the arc is described by.
 */
const START_DEGREES = (360 - SWEEP_DEGREES) / 2 + 90

interface ProgressRingProps {
  /** How far round, 0 to 1. Clamped, because a ring that has gone past its end reads as a bug. */
  progress: number
  size: number
  /**
   * Ring thickness. Kept proportional by the caller rather than derived, so a small ring stays
   * legible.
   */
  thickness?: number
  /** The fill's token; the accent unless the ring sits on an accent fill. */
  color?: string | undefined
}

/**
 * A determinate ring, open at the bottom.
 *
 * A ring rather than a bar because that is what both mobile clients draw for this -- iOS's
 * `CircularProgressView` and Android's `ProgressArc` -- and they agree on the copy beside it too.
 *
 * Drawn with a dash pattern rather than an arc path: one circle and two lengths, with no
 * trigonometry to get wrong at the wrap-around. The dash begins at three o'clock and runs clockwise
 * in SVG, which is the same convention SwiftUI and Compose use, so the angles above are the
 * clients' own numbers rather than a translation of them.
 */
export function ProgressRing({
  progress,
  size,
  thickness = 4,
  color = '$primaryColor',
}: ProgressRingProps) {
  const track = useTokenColor('$bordersColor')
  const fill = useTokenColor(color)
  const radius = (size - thickness) / 2
  const circumference = 2 * Math.PI * radius
  const fraction = Math.min(1, Math.max(0, progress))
  /** The drawn part of the circle. Everything below measures against this, not the whole. */
  const arc = circumference * (SWEEP_DEGREES / 360)
  const spin = `rotate(${String(START_DEGREES)} ${String(size / 2)} ${String(size / 2)})`

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${String(size)} ${String(size)}`}>
      {/* The track, drawn at the full sweep so the gap is visible before anything fills. Both
          clients draw one, in their border colour rather than a dimmed accent, so it reads as the
          shape the ring will fill rather than as a second, paler ring. */}
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke={track}
        strokeWidth={thickness}
        fill="none"
        strokeLinecap="round"
        // `arc` then a gap of everything else: one dash, so the track stops where the arc does.
        strokeDasharray={`${String(arc)} ${String(circumference)}`}
        transform={spin}
      />
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke={fill}
        strokeWidth={thickness}
        fill="none"
        strokeLinecap="round"
        // A fraction of the arc rather than of the circle: at 100% the fill reaches the end of the
        // track and stops, instead of carrying on round into the gap.
        strokeDasharray={`${String(arc * fraction)} ${String(circumference)}`}
        transform={spin}
      />
    </Svg>
  )
}
