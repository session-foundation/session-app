import { Avatar } from '../../Avatar'
import { ProgressRing, ProgressRingFrame } from '../../ProgressRing'
import { RadioIndicator } from '../../RadioIndicator'
import { SIZE_SCALE } from '../../scales'
import { defineStory } from '../story'

export const radio = defineStory<{ selected: boolean; disabled?: boolean }>({
  component: 'radioIndicator',
  story: 'states',
  width: 40,
  variants: {
    off: { selected: false },
    on: { selected: true },
    offDisabled: { selected: false, disabled: true },
    onDisabled: { selected: true, disabled: true },
  },
  render: (props) => <RadioIndicator {...props} />,
})

/**
 * The Settings display picture enlarged: initials past the top of the type ramp keep growing with
 * the disc. One letter, whose share of the disc is the larger; the Settings header's own page draws
 * two letters at both of its sizes.
 */
const ENLARGED_AVATAR_PX = 190

export const avatar = defineStory<{ name: string; size: 'xl' | '2xl' | '3xl' | number }>({
  component: 'avatar',
  story: 'sizes',
  width: ENLARGED_AVATAR_PX,
  variants: {
    xl: { name: 'Alice', size: 'xl' },
    '2xl': { name: 'Bob', size: '2xl' },
    '3xl': { name: 'Zoë', size: '3xl' },
    emoji: { name: '🦊 Fox', size: '2xl' },
    arabic: { name: 'ليلى', size: '2xl' },
    enlargedOneLetter: { name: 'Q', size: ENLARGED_AVATAR_PX },
  },
  render: ({ name, size }) => <Avatar id={`05${name}`} name={name} size={size} />,
})

interface RingRow {
  /** Absent for a ring that does not know how far along it is. */
  progress?: number | undefined
  trackColor?: string | undefined
  /** A fixed frame of the gap opening once a reading arrives: the track's sweep, in degrees. */
  openingSweep?: number | undefined
}

/** `ProgressRing`'s own default, which the frame is not given. */
const RING_THICKNESS = 4

export const progressRing = defineStory<RingRow>({
  component: 'progressRing',
  story: 'progress',
  width: 48,
  sensitive: { accent: true },
  variants: {
    empty: { progress: 0 },
    quarter: { progress: 0.25 },
    half: { progress: 0.5 },
    full: { progress: 1 },
    // A closed track, its arc held at the top in a capture: the catalog asks for reduced motion
    // and cancels animations. On the footer's track, the only track an indeterminate ring has.
    indeterminate: { trackColor: '$progressTrack' },
    // Half way from the closed track to the open one, before any fill is drawn.
    opening: { openingSweep: 330, trackColor: '$progressTrack' },
  },
  render: ({ progress, trackColor, openingSweep }) =>
    openingSweep !== undefined ? (
      <ProgressRingFrame
        size={SIZE_SCALE.xl}
        thickness={RING_THICKNESS}
        color="$primaryColor"
        trackColor={trackColor ?? '$bordersColor'}
        trackSweepDegrees={openingSweep}
        reading={null}
        still
      />
    ) : progress === undefined ? (
      <ProgressRing indeterminate size={SIZE_SCALE.xl} trackColor={trackColor} />
    ) : (
      <ProgressRing progress={progress} size={SIZE_SCALE.xl} trackColor={trackColor} />
    ),
})
