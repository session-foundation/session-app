import type { ReactNode } from 'react'
import { Modal as NativeModal, Platform } from 'react-native'
import { XStack } from 'tamagui'

import { BarButton } from './BarButton'
import { SIZE_SCALE } from './scales'
import { useTopBarControlsPadding } from './windowControls'

/**
 * The platform's navigation bar, which draws the close of a modal on the native stack: iOS's 44 pt
 * bar with its 44 pt glass button, Android's 56 dp toolbar. A full-screen layer's close is laid out
 * to the same, so it sits where Settings' close did; both put the button 16 in from the start edge.
 */
export const FULL_SCREEN_BAR = {
  height: Platform.OS === 'ios' ? 44 : SIZE_SCALE['4xl'],
  glassDiameter: 44,
} as const

export interface FullScreenBarProps {
  onClose: () => void
  closeLabel: string
  closeTestID?: string | undefined
  /** Between the close and `trailing`, taking the room left; nothing when omitted. */
  title?: ReactNode | undefined
  /** At the end of the bar: the layer's own action, such as Export. */
  trailing?: ReactNode | undefined
}

/**
 * A full-screen layer's top bar: its close where the system's bar puts a modal's, an optional title
 * and an action at the end, clear of a window's own controls where an iPad draws them over the app.
 * Presses beside its buttons pass through, so a layer that closes on a press anywhere still does.
 */
export function FullScreenBar({
  onClose,
  closeLabel,
  closeTestID,
  title,
  trailing,
}: FullScreenBarProps) {
  const controlsPadding = useTopBarControlsPadding()
  return (
    <XStack
      height={FULL_SCREEN_BAR.height}
      alignItems="center"
      gap="$sm"
      paddingHorizontal="$md"
      {...(controlsPadding.left === undefined ? {} : { paddingLeft: controlsPadding.left })}
      {...(controlsPadding.right === undefined ? {} : { paddingRight: controlsPadding.right })}
      pointerEvents="box-none"
    >
      <BarButton
        icon="x"
        accessibilityLabel={closeLabel}
        onPress={onClose}
        glassDiameter={FULL_SCREEN_BAR.glassDiameter}
        testID={closeTestID}
      />
      <XStack flex={1} alignItems="center" pointerEvents="box-none">
        {title}
      </XStack>
      {trailing}
    </XStack>
  )
}

/**
 * A layer over the whole window, faded in and out, closed by the platform's back or Escape
 * (`onRequestClose`).
 *
 * In react-native's `Modal`, because a child that overflows its parent is clipped on Android, and
 * a layer is the size of the window. **The caller keeps its content drawn while `open` turns
 * false**: the modal fades out what it holds, and an empty one fades out its own background, which
 * is white, in its place.
 */
export function FullScreenModal({
  open,
  onClose,
  toasts,
  children,
}: {
  open: boolean
  onClose: () => void
  /**
   * The toast layer, drawn inside on Android only. There the modal is a window of its own over the
   * app's, and toasts drawn in the app's would be hidden behind it until it closed. iOS lifts the
   * app's toasts above every window, and the desktop draws them above its modals.
   */
  toasts?: ReactNode | undefined
  children: ReactNode
}) {
  return (
    <NativeModal visible={open} transparent={false} animationType="fade" onRequestClose={onClose}>
      {children}
      {Platform.OS === 'android' ? toasts : null}
    </NativeModal>
  )
}
