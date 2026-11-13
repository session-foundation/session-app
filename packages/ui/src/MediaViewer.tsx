import { useState, type ReactNode } from 'react'
import { isWeb, XStack, YStack } from 'tamagui'

import type { ElementId } from '@session/test-ids'

import { TILE_SCRIM } from './attachmentTileStyle'
import { backChevron, forwardChevron } from './backChevron'
import { BarButton } from './BarButton'
import { FULL_SCREEN_BAR, FullScreenBar, FullScreenModal } from './FullScreen'
import { Icon } from './Icon'
import type { IconName } from './Icon.types'
import { SIZE_SCALE } from './scales'
import { Image } from './Image'
import { SafeArea } from './SafeArea'
import { Text } from './Text'
import { useWindowSize } from './useWindowSize'
import { drawnUri, type MediaViewerItem } from './viewerItem'

export type { MediaViewerItem }

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
  /** Already worded: shown while an item is `preparing`. */
  preparingLabel: string
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
  /** On the line saying an item is being prepared. */
  preparingTestID?: ElementId | undefined
  /** See `FullScreenModal`'s: so an export failure is seen while the picture is still up. */
  toasts?: ReactNode | undefined
}

export type MediaViewerBodyProps = Omit<MediaViewerProps, 'open' | 'toasts'>

/**
 * Grows a chevron drawn at `$xl` to Android's 48 target, which clears Apple's 44. Touch only, and
 * only as far as the control's parent.
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
      {/* Over the picture it sits on the fixed scrim, which is dark in every theme. */}
      <Icon name={icon} size="md" color={overMedia ? '$surfaceInverted' : '$textPrimary'} />
    </YStack>
  )
}

/**
 * The viewer's chrome, picture and chevrons, filling its parent. `MediaViewer` shows it over the
 * window; on its own it is what a page draws a viewer state in.
 *
 * Deliberately the least ambitious thing that makes a gallery mean something. **No zoom of any
 * kind** - a pinch needs a gesture arbiter between the pager and the image, and getting that wrong
 * is worse than not having it. No swipe to dismiss, no filmstrip, no editing.
 *
 * The chevrons step through **one message's** previewable attachments, not the conversation's
 * media history, and they stop at the ends rather than wrapping - wrapping hides how many there
 * are.
 */
export function MediaViewerBody({
  items,
  index,
  onIndex,
  onClose,
  onExport,
  positionLabel,
  unavailableLabel,
  failedLabel,
  preparingLabel,
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
  preparingTestID,
}: MediaViewerBodyProps) {
  const { width, height } = useWindowSize()
  // The box the picture gets, measured, since the safe area's insets are the platform's to know.
  const [box, setBox] = useState({ width, height: Math.max(height - FULL_SCREEN_BAR.height, 0) })
  const current = items[index]
  // By url, so paging to another picture is not drawn as failed, and one that is fetched again
  // under a new url is tried again.
  const [failedUris, setFailedUris] = useState<readonly string[]>([])
  const drawn = current === undefined ? null : drawnUri(current, failedUris)
  const failed = current?.failed === true || (current?.uri != null && drawn === null)
  return (
    <YStack flex={1} backgroundColor="$backgroundPrimary" testID={testID}>
      {/* A modal is drawn edge to edge on Android, under the status bar where nothing can be
          tapped, so the chrome keeps clear of it like any screen. */}
      <SafeArea>
        <YStack position="relative" flex={1}>
          {/* Along the top, and nothing along the bottom: the bottom edge is where a thumb
              rests. */}
          <FullScreenBar
            onClose={onClose}
            closeLabel={closeLabel}
            closeTestID={closeTestID}
            title={
              <Text size="$label" color="$textSecondary">
                {positionLabel}
              </Text>
            }
            trailing={
              <BarButton
                icon="download"
                accessibilityLabel={exportLabel}
                onPress={onExport}
                glassDiameter={FULL_SCREEN_BAR.glassDiameter}
                testID={exportTestID}
              />
            }
          />

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
            {drawn === null && current?.preparing != null ? (
              <>
                <Text size="$body" color="$textSecondary" testID={preparingTestID}>
                  {preparingLabel}
                </Text>
                {/* Out of sight: loading it is the ask, and what it draws is not this. */}
                <YStack position="absolute" width={1} height={1} opacity={0} aria-hidden>
                  <Image uri={current.preparing} width={1} height={1} fit="contain" />
                </YStack>
              </>
            ) : drawn === null ? (
              <Text size="$body" color="$textSecondary">
                {failed ? failedLabel : unavailableLabel}
              </Text>
            ) : (
              // The box below the header, not the window: sized to the window it overflows the
              // column it is in, and what gets squeezed out is the chrome above it. `contain`
              // because this is somebody being shown their own picture - a crop here would be
              // hiding part of the thing they opened.
              <Image
                uri={drawn}
                width={box.width}
                height={box.height}
                fit="contain"
                testID={imageTestID}
                onError={() => {
                  setFailedUris((was) => [...was, drawn])
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
  )
}

/**
 * One picture, full screen, over whatever was on screen.
 *
 * **A layer rather than a route.** It covers the conversation instead of navigating away, so
 * dismissing it restores the transcript's scroll position for nothing and anything playing above
 * it keeps going.
 *
 * Each opening draws a fresh body, so a picture that failed is tried again. The body stays mounted
 * once closed, which is what `FullScreenModal` asks of its content.
 */
export function MediaViewer({ open, onClose, toasts, ...body }: MediaViewerProps) {
  const [opening, setOpening] = useState(0)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setOpening((count) => count + 1)
  }
  return (
    <FullScreenModal open={open} onClose={onClose} toasts={toasts}>
      <MediaViewerBody key={opening} {...body} onClose={onClose} />
    </FullScreenModal>
  )
}
