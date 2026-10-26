import { isWeb, YStack, type GroupNames } from 'tamagui'

import { TILE_SCRIM } from './attachmentTileStyle'
import { FEEDBACK_TRANSITION } from './feedbackTransition'
import { Icon } from './Icon'
import type { WithTestID } from './with'

/** Below this a tile has room for the small glyph only. */
const LARGE_TILE = 90

/**
 * A cloud over pictures a press would download rather than open, shown while `group` above it is
 * hovered or pressed, which needs `position="relative"`. Drawn on the fixed photo scrim.
 */
export function FetchHint({
  side,
  group,
  restsOnTouch = false,
  onPress,
  label,
  testID,
}: Partial<WithTestID> & {
  side: number
  group: GroupNames
  /**
   * Shown without a press on touch, where nothing hovers; off where the row already offers
   * Download.
   */
  restsOnTouch?: boolean | undefined
  /**
   * Makes the cloud itself take a press, where it sits over a seam between tiles that would
   * otherwise swallow it. On the web it is then the set's named control; on native it is out of
   * the accessibility tree, test id included, since the footer offers the same verb.
   */
  onPress?: (() => void) | undefined
  /** Already worded; what the pressable cloud is announced as on the web. */
  label?: string | undefined
}) {
  const small = side < LARGE_TILE
  return (
    <YStack
      position="absolute"
      top={0}
      bottom={0}
      left={0}
      right={0}
      alignItems="center"
      justifyContent="center"
      opacity={restsOnTouch && !isWeb ? 0.8 : 0}
      pointerEvents={onPress === undefined ? 'none' : 'box-none'}
      style={FEEDBACK_TRANSITION}
      {...{
        [`$group-${group}-hover`]: { opacity: 0.8 },
        [`$group-${group}-press`]: { opacity: 1 },
      }}
    >
      <YStack
        padding={small ? '$3xs' : '$xs'}
        borderRadius="$full"
        backgroundColor={TILE_SCRIM}
        {...(onPress === undefined
          ? {}
          : {
              onPress,
              '$platform-web': { cursor: 'pointer' },
              testID,
              ...(isWeb ? { role: 'button', 'aria-label': label } : { 'aria-hidden': true }),
            })}
      >
        <Icon name="cloudDownload" size={small ? 'xs' : 'md'} color="$textPrimary" />
      </YStack>
    </YStack>
  )
}
