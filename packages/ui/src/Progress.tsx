import { YStack } from 'tamagui'

// A plain number rather than a token: the size scale starts at 8, which is twice as tall as a
// bar should be, and a `$` name that does not exist resolves to 0 in silence.
const BAR_HEIGHT = 4

export interface ProgressProps {
  /**
   * How far along, from 0 to 1. Absent means the size is not known yet, which is what a
   * transfer reports until the server answers - the track is drawn and the fill is not.
   */
  value?: number
  /**
   * The colours are the caller's because this is drawn inside a message bubble as often as on
   * the screen, and the accent tone that reads against one is invisible against the other.
   */
  color?: string
  trackColor?: string
  testID?: string
}

/**
 * A determinate bar.
 *
 * Deliberately not animated by its own value changing: reports arrive at whatever rate the
 * transfer produces them, seconds apart on a slow file and not at all on a cached one, so a
 * transition tied to them reads as stalling rather than as progress.
 */
export function Progress({
  value,
  color = '$primaryColor',
  trackColor = '$backgroundTertiary',
  testID,
}: ProgressProps) {
  const fraction = value === undefined ? undefined : Math.min(1, Math.max(0, value))


  return (
    <YStack
      height={BAR_HEIGHT}
      width="100%"
      borderRadius="$full"
      backgroundColor={trackColor}
      overflow="hidden"
      testID={testID}
    >
      {fraction === undefined ? null : (
        <YStack height="100%" width={`${String(fraction * 100)}%`} backgroundColor={color} />
      )}
    </YStack>
  )
}
