import { Modal as NativeModal } from 'react-native'
import { XStack, YStack } from 'tamagui'

import { SPACING } from '@session/theme-tokens'

import { Icon } from './Icon'
import { SIZE_SCALE } from './scales'
import { Image } from './Image'
import { isLayoutRtl } from './layoutDirection'
import { Text } from './Text'
import { useWindowSize } from './useWindowSize'

export interface MediaViewerItem {
  /** Null where this platform has no resolver for the bytes, which is a state, not a failure. */
  uri: string | null
  kind: 'image' | 'video'
}

export interface MediaViewerProps {
  open: boolean
  items: readonly MediaViewerItem[]
  /** Which one is showing. Held by the caller, so reopening at a given index costs nothing. */
  index: number
  onIndex: (index: number) => void
  onClose: () => void
  onExport: () => void
  onMore: () => void
  /** Already worded: this package cannot reach the catalogue. "2 of 5". */
  positionLabel: string
  /** Shown in place of a picture this platform cannot draw. */
  unavailableLabel: string
  closeLabel: string
  exportLabel: string
  moreLabel: string
  previousLabel: string
  nextLabel: string
  testID: string
  closeTestID: string
}

/**
 * One picture, full screen, over whatever was on screen.
 *
 * **A layer rather than a route.** It covers the conversation instead of navigating away, so
 * dismissing it restores the transcript's scroll position for nothing and anything playing above
 * it keeps going. In react-native's `Modal` for the reason `Modal` itself is: a child that
 * overflows its parent is clipped on Android, and this one is the size of the window.
 *
 * Deliberately the least ambitious thing that makes a gallery mean something. **No zoom of any
 * kind** - a pinch needs a gesture arbiter between the pager and the image, and getting that wrong
 * is worse than not having it. **No video playback**: a video opens the platform's own player, so
 * a pager that sometimes holds one would be two components pretending to be one. No swipe to
 * dismiss, no filmstrip, no editing.
 *
 * The chevrons step through **one message's** previewable attachments, not the conversation's
 * media history, and they stop at the ends rather than wrapping - wrapping hides how many there
 * are.
 */
/**
 * The chrome along the top, as a fixed height.
 *
 * A number because the picture below is measured against it, and a header that took its height
 * from its content would make that measurement a guess. `$xl` control plus the air around it.
 */
const HEADER_HEIGHT = SIZE_SCALE.xl + SPACING.sm

export function MediaViewer({
  open,
  items,
  index,
  onIndex,
  onClose,
  onExport,
  onMore,
  positionLabel,
  unavailableLabel,
  closeLabel,
  exportLabel,
  moreLabel,
  previousLabel,
  nextLabel,
  testID,
  closeTestID,
}: MediaViewerProps) {
  const { width, height } = useWindowSize()
  const current = items[index]
  const rtl = isLayoutRtl()

  return (
    <NativeModal visible={open} transparent={false} animationType="fade" onRequestClose={onClose}>
      {/* `relative`, so the chevrons below resolve against this and not the page: on the web a
          stack is static unless it says so, and react-native's Modal does not supply one. */}
      <YStack position="relative" flex={1} backgroundColor="$backgroundPrimary" testID={testID}>
        {/* Along the top, and nothing along the bottom: the bottom edge is where a thumb rests. */}
        <XStack height={HEADER_HEIGHT} alignItems="center" gap="$xs" paddingHorizontal="$sm">
          <Control icon="x" label={closeLabel} onPress={onClose} testID={closeTestID} />
          <Text size="$label" color="$textSecondary" flex={1}>
            {positionLabel}
          </Text>
          <Control icon="hardDriveDownload" label={exportLabel} onPress={onExport} />
          <Control icon="ellipsis" label={moreLabel} onPress={onMore} />
        </XStack>

        <YStack flex={1} alignItems="center" justifyContent="center">
          {current === undefined || current.uri === null ? (
            <Text size="$body" color="$textSecondary">
              {unavailableLabel}
            </Text>
          ) : (
            // The box is the window minus the header, not the window: sized to the window it
            // overflows the column it is in, and what gets squeezed out is the chrome above it.
            // `contain` because this is somebody being shown their own picture - a crop here
            // would be hiding part of the thing they opened.
            <Image
              uri={current.uri}
              width={width}
              height={Math.max(height - HEADER_HEIGHT, 0)}
              fit="contain"
            />
          )}
        </YStack>

        {items.length < 2 ? null : (
          <XStack
            position="absolute"
            top={0}
            bottom={0}
            left={0}
            right={0}
            alignItems="center"
            justifyContent="space-between"
            paddingHorizontal="$xs"
            pointerEvents="box-none"
          >
            {/* The glyph follows reading order, the index does not: previous is always index - 1,
                and in a mirrored layout it is the chevron on the right that draws it. */}
            <Control
              icon={rtl ? 'chevronRight' : 'chevronLeft'}
              label={previousLabel}
              disabled={index <= 0}
              onPress={() => {
                onIndex(index - 1)
              }}
            />
            <Control
              icon={rtl ? 'chevronLeft' : 'chevronRight'}
              label={nextLabel}
              disabled={index >= items.length - 1}
              onPress={() => {
                onIndex(index + 1)
              }}
            />
          </XStack>
        )}
      </YStack>
    </NativeModal>
  )
}

function Control({
  icon,
  label,
  onPress,
  disabled = false,
  testID,
}: {
  icon: 'x' | 'chevronLeft' | 'chevronRight' | 'hardDriveDownload' | 'ellipsis'
  label: string
  onPress: () => void
  disabled?: boolean
  testID?: string
}) {
  return (
    <YStack
      width="$xl"
      height="$xl"
      borderRadius="$full"
      alignItems="center"
      justifyContent="center"
      opacity={disabled ? 0.35 : 1}
      accessibilityLabel={label}
      accessibilityRole="button"
      {...(disabled ? {} : { onPress })}
      {...(testID === undefined ? {} : { testID })}
    >
      <Icon name={icon} size="md" color="$textPrimary" />
    </YStack>
  )
}
