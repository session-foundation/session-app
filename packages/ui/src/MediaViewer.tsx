import { useState } from 'react'
import { Modal as NativeModal } from 'react-native'
import { isWeb, XStack, YStack } from 'tamagui'

import type { ElementId } from '@session/test-ids'
import { SPACING } from '@session/theme-tokens'

import { TILE_SCRIM } from './attachmentTileStyle'
import { backChevron, forwardChevron } from './backChevron'
import { Icon } from './Icon'
import type { IconName } from './Icon.types'
import { SIZE_SCALE } from './scales'
import { Image } from './Image'
import { SafeArea } from './SafeArea'
import { Text } from './Text'
import { useWindowSize } from './useWindowSize'

export type MediaViewerItem = {
  /** Null where this platform has no resolver for the bytes, which is a state, not a failure. */
  uri: string | null
}

export interface MediaViewerProps {
  open: boolean
  items: readonly MediaViewerItem[]
  /** Which one is showing. Held by the caller, so reopening at a given index costs nothing. */
  index: number
  onIndex: (index: number) => void
  onClose: () => void
  onExport: () => void
  /** Already worded: this package cannot reach the catalogue. "2 of 5". */
  positionLabel: string
  /** Shown in place of a picture this platform cannot draw. */
  unavailableLabel: string
  /** Shown in place of a picture whose bytes did not load, which an image does not retry. */
  failedLabel: string
  closeLabel: string
  exportLabel: string
  previousLabel: string
  nextLabel: string
  testID: ElementId
  closeTestID: ElementId
  exportTestID: ElementId
  previousTestID: ElementId
  nextTestID: ElementId
  imageTestID: ElementId
}

/**
 * Grows a control drawn at `$xl` to Android's 48 target, which clears Apple's 44. Touch only, and
 * only as far as the control's parent: `HEADER_HEIGHT` is what lets the header's two reach it.
 */
const CONTROL_SLOP = (SIZE_SCALE['3xl'] - SIZE_SCALE.xl) / 2

function Control({
  icon,
  label,
  onPress,
  disabled = false,
  overMedia = false,
  testID,
}: {
  icon: IconName
  label: string
  onPress: () => void
  disabled?: boolean | undefined
  /** Drawn over the picture rather than the chrome, so it carries its own backdrop. */
  overMedia?: boolean | undefined
  testID?: ElementId | undefined
}) {
  return (
    <YStack
      width="$xl"
      height="$xl"
      borderRadius="$full"
      alignItems="center"
      justifyContent="center"
      opacity={disabled ? 0.35 : 1}
      {...(overMedia ? { backgroundColor: TILE_SCRIM } : {})}
      // The aria spellings reach both the DOM and the native view; react-native's reach the DOM as
      // nothing, which would leave a disabled chevron announced as pressable.
      role="button"
      aria-label={label}
      aria-disabled={disabled}
      {...(disabled ? {} : { onPress })}
      {...(isWeb ? {} : { hitSlop: CONTROL_SLOP })}
      testID={testID}
    >
      <Icon name={icon} size="md" color="$textPrimary" />
    </YStack>
  )
}

/**
 * The chrome along the top, as a fixed height.
 *
 * A number because the picture below is measured against it, and a header that took its height
 * from its content would make that measurement a guess. On touch, the 48 a control's slop grows
 * it to, since a slop is clipped to the row; on the web, `$xl` control plus the air around it.
 */
const HEADER_HEIGHT = isWeb ? SIZE_SCALE.xl + SPACING.sm : SIZE_SCALE['3xl']

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
 * is worse than not having it. No swipe to dismiss, no filmstrip, no editing.
 *
 * The chevrons step through **one message's** previewable attachments, not the conversation's
 * media history, and they stop at the ends rather than wrapping - wrapping hides how many there
 * are.
 */
export function MediaViewer({
  open,
  items,
  index,
  onIndex,
  onClose,
  onExport,
  positionLabel,
  unavailableLabel,
  failedLabel,
  closeLabel,
  exportLabel,
  previousLabel,
  nextLabel,
  testID,
  closeTestID,
  exportTestID,
  previousTestID,
  nextTestID,
  imageTestID,
}: MediaViewerProps) {
  const { width, height } = useWindowSize()
  // The box the picture gets, measured, since the safe area's insets are the platform's to know.
  const [box, setBox] = useState({ width, height: Math.max(height - HEADER_HEIGHT, 0) })
  const current = items[index]
  // By url, so paging to another picture is not drawn as failed, and one that is fetched again
  // under a new url is tried again.
  const [failedUri, setFailedUri] = useState<string | null>(null)
  const failed = current?.uri != null && current.uri === failedUri
  const close = (): void => {
    setFailedUri(null)
    onClose()
  }

  return (
    <NativeModal visible={open} transparent={false} animationType="fade" onRequestClose={close}>
      <YStack flex={1} backgroundColor="$backgroundPrimary" testID={testID}>
        {/* A modal is drawn edge to edge on Android, under the status bar where nothing can be
            tapped, so the chrome keeps clear of it like any screen. */}
        <SafeArea>
          <YStack position="relative" flex={1}>
            {/* Along the top, and nothing along the bottom: the bottom edge is where a thumb
                rests. */}
            <XStack height={HEADER_HEIGHT} alignItems="center" gap="$xs" paddingHorizontal="$sm">
              <Control icon="x" label={closeLabel} onPress={close} testID={closeTestID} />
              <Text size="$label" color="$textSecondary" flex={1}>
                {positionLabel}
              </Text>
              <Control
                icon="download"
                label={exportLabel}
                onPress={onExport}
                testID={exportTestID}
              />
            </XStack>

            {/* The chevrons are laid over this box rather than the whole screen, so they centre on
                the picture and not on a height that includes the header. */}
            <YStack
              position="relative"
              flex={1}
              alignItems="center"
              justifyContent="center"
              onLayout={(event) => {
                const measured = event.nativeEvent.layout
                setBox({ width: measured.width, height: measured.height })
              }}
            >
              {current === undefined || current.uri === null || failed ? (
                <Text size="$body" color="$textSecondary">
                  {failed ? failedLabel : unavailableLabel}
                </Text>
              ) : (
                // The box below the header, not the window: sized to the window it overflows the
                // column it is in, and what gets squeezed out is the chrome above it. `contain`
                // because this is somebody being shown their own picture - a crop here would be
                // hiding part of the thing they opened.
                <Image
                  uri={current.uri}
                  width={box.width}
                  height={box.height}
                  fit="contain"
                  testID={imageTestID}
                  onError={() => {
                    setFailedUri(current.uri)
                  }}
                />
              )}
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
                  {/* The glyph follows reading order, the index does not: previous is always
                  index - 1, and in a mirrored layout it is the chevron on the right that draws
                  it. */}
                  <Control
                    icon={backChevron()}
                    label={previousLabel}
                    disabled={index <= 0}
                    overMedia
                    testID={previousTestID}
                    onPress={() => {
                      onIndex(index - 1)
                    }}
                  />
                  <Control
                    icon={forwardChevron()}
                    label={nextLabel}
                    disabled={index >= items.length - 1}
                    overMedia
                    testID={nextTestID}
                    onPress={() => {
                      onIndex(index + 1)
                    }}
                  />
                </XStack>
              )}
            </YStack>
          </YStack>
        </SafeArea>
      </YStack>
    </NativeModal>
  )
}
