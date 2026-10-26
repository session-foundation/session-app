import type { ReactNode } from 'react'
import { Modal as NativeModal } from 'react-native'
import { ScrollView, XStack, YStack, useMedia } from 'tamagui'

import type { ElementId } from '@session/test-ids'

import { Button } from './Button'
import { Icon } from './Icon'
import { useScreenInsets } from './screenInsets'
import { SHEET_MAX_HEIGHT, SHEET_MAX_WIDTH, SHEET_RADIUS } from './sheetLayout'
import { Text } from './Text'

export interface SheetProps {
  open: boolean
  onClose: () => void
  title: string
  /** Names the close control for a screen reader, since it is drawn as a cross. */
  closeLabel: string
  /** The scrolling part. As tall as it needs to be, up to what the surface allows. */
  children: ReactNode
  /**
   * The body is a `List`, which scrolls and windows itself, so the sheet adds no scroller of its
   * own. For a body long enough that mounting every row at once is felt as a pause on opening.
   */
  bodyIsList?: boolean | undefined
  /** Held at the bottom edge, outside the scroll, so it is reachable from anywhere in the body. */
  footer?: ReactNode | undefined
  /**
   * Drawn inside this sheet's own modal, above it: where anything opened from the sheet has to
   * go. iOS presents a modal from its parent's view controller, and a sibling's is already busy
   * presenting this one, so a modal rendered beside the sheet never appears while it is open.
   */
  overlay?: ReactNode | undefined
  testID: ElementId
  closeTestID: ElementId
  scrimTestID: ElementId
}

/**
 * A surface for more content than a message can hold.
 *
 * **A bottom sheet on a phone and a centred dialog on anything wider**, which is the same split
 * `AdaptiveShell` makes and the same breakpoint: a tablet in landscape has the room for a dialog
 * and a phone does not. One component rather than a pair, because only the placement differs -
 * the header, the scrolling body and the pinned footer are the same three parts either way.
 *
 * Not `Modal`: that one is the client's alert, at an alert's width and with its buttons welded to
 * the bottom corners. What is wanted here is a container, and giving the alert a second shape
 * would make every caller of it read the variants to find out which they were getting.
 */
export function Sheet({
  open,
  onClose,
  title,
  closeLabel,
  children,
  bodyIsList = false,
  footer,
  overlay,
  testID,
  closeTestID,
  scrimTestID,
}: SheetProps) {
  const wide = useMedia().gtSm
  const insets = useScreenInsets()

  return (
    <NativeModal
      visible={open}
      transparent
      animationType={wide ? 'fade' : 'slide'}
      onRequestClose={onClose}
    >
      {/* The scrim is what closes, as a sibling behind the sheet rather than an ancestor of it: a
          press handler on an ancestor claims every touch that starts in the sheet, and the list
          inside then cannot start a scroll from a slow drag. */}
      <YStack
        fullscreen
        backgroundColor="$scrim"
        // Hidden from a reader: it is a second way to close, and Close is already announced.
        aria-hidden
        onPress={onClose}
        testID={scrimTestID}
      />
      <YStack
        fullscreen
        alignItems="center"
        justifyContent={wide ? 'center' : 'flex-end'}
        {...(wide ? { padding: '$xl' } : {})}
        pointerEvents="box-none"
      >
        <YStack
          width="100%"
          maxHeight={SHEET_MAX_HEIGHT}
          {...(wide ? { maxWidth: SHEET_MAX_WIDTH } : {})}
          borderTopLeftRadius={SHEET_RADIUS}
          borderTopRightRadius={SHEET_RADIUS}
          // Square against the bottom of the window on a phone, because there is nothing under it
          // to round away from.
          {...(wide
            ? { borderBottomLeftRadius: SHEET_RADIUS, borderBottomRightRadius: SHEET_RADIUS }
            : { paddingBottom: insets.bottom })}
          backgroundColor="$backgroundSecondary"
          testID={testID}
        >
          <XStack alignItems="center" gap="$xs" paddingHorizontal="$md" paddingVertical="$sm">
            <Text flex={1} size="$bodyLarge" weight="bold" numberOfLines={1} userSelect="none">
              {title}
            </Text>
            <Button
              variant="ghost"
              size="md"
              circular
              accessibilityLabel={closeLabel}
              testID={closeTestID}
              onPress={onClose}
              icon={<Icon name="x" size="lg" color="$textPrimary" />}
            />
          </XStack>

          {/* The body scrolls and the footer does not, so a long set cannot push the one control
              that acts on all of it off the bottom of the screen.

              Chrome makes a scroller with no tab-focusable children focusable itself, and the
              rows are `role="button"` without a tabindex - so the body took focus and drew the
              UA's ring round all of it. */}
          {bodyIsList ? (
            children
          ) : (
            <ScrollView outlineStyle="none">
              <YStack paddingHorizontal="$md" paddingBottom="$sm">
                {children}
              </YStack>
            </ScrollView>
          )}

          {footer === undefined ? null : (
            // A rule above it, because the body scrolls under: without one the row cut off at the
            // scroll boundary runs straight into the footer and reads as a broken row.
            <YStack
              paddingHorizontal="$md"
              paddingBottom="$sm"
              borderTopWidth={1}
              borderTopColor="$bordersColor"
            >
              {footer}
            </YStack>
          )}
        </YStack>
      </YStack>
      {overlay}
    </NativeModal>
  )
}
