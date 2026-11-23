import { Platform, Switch as NativeSwitch } from 'react-native'

import { isLayoutRtl } from './layoutDirection'
import { useTokenColor } from './useTokenColor'

export interface SwitchProps {
  value: boolean
  onValueChange: (value: boolean) => void
  /** What it switches, for a screen reader; usually the row's label. */
  accessibilityLabel: string
  disabled?: boolean | undefined
  testID: string
}

/**
 * An on/off switch: the platform's own on iOS and Android, as the legacy clients have, and
 * react-native-web's on desktop, in the theme's colours.
 *
 * On is the accent. Off is `progressTrack`, the role for an unfilled track: translucent ink, so it
 * reads as off on a card, the page or a nested card alike, where a surface step all but vanished on
 * a dark card and the border role, saturated in some themes, read as a state. The thumb is
 * `surfaceInverted`, light in every theme, since a dark thumb reads as off.
 */
export function Switch({
  value,
  onValueChange,
  accessibilityLabel,
  disabled,
  testID,
}: SwitchProps) {
  const on = useTokenColor('$primaryColor')
  const off = useTokenColor('$progressTrack')
  const thumb = useTokenColor('$surfaceInverted')
  const thumbDisabled = useTokenColor('$textDisabled')
  // iOS and Android fade a disabled switch themselves; react-native-web's only sign of it is a grey
  // thumb, which a thumb colour replaces, so on the web the thumb takes the disabled role instead.
  const webThumb = disabled === true ? thumbDisabled : thumb
  // react-native-web places the thumb with a CSS logical inset, which follows the page's `dir`, and
  // a start margin it resolves against its own direction, which stays left to right; on a right to
  // left page the two disagree and the thumb lands off the track. So the web switch is drawn left
  // to right and mirrored, which puts on at the leading edge as iOS and Android do.
  const webStyle =
    Platform.OS === 'web'
      ? { direction: 'ltr' as const, ...(isLayoutRtl() ? { transform: [{ scaleX: -1 }] } : {}) }
      : undefined
  return (
    <NativeSwitch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled ?? false}
      trackColor={{ false: off, true: on }}
      thumbColor={Platform.OS === 'web' ? webThumb : thumb}
      // react-native-web takes the on thumb from a prop of its own and draws it teal without one.
      {...(Platform.OS === 'web' ? { activeThumbColor: webThumb } : {})}
      // iOS paints the off track from this rather than trackColor while it animates.
      ios_backgroundColor={off}
      style={webStyle}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    />
  )
}
