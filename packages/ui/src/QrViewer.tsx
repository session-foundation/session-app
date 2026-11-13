import { useState, type ReactNode } from 'react'
import { YStack } from 'tamagui'

import { Button } from './Button'
import { ContextMenu, type ContextMenuTestIDs } from './ContextMenu'
import type { ContextMenuEntry } from './contextMenuEntries'
import type { MenuAnchor } from './contextMenuPlacement'
import { ContextMenuTarget } from './ContextMenuTarget'
import { FullScreenBar, FullScreenModal } from './FullScreen'
import { Icon } from './Icon'
import type { IconName } from './Icon.types'
import { PressArea } from './PressArea'
import { QrCode, type QrCodeProps } from './QrCode'
import { useScreenInsets } from './screenInsets'
import { useWindowSize } from './useWindowSize'

/** The code's share of the window's shorter side. */
const WINDOW_SHARE = 0.75

export interface QrViewerMenu {
  entries: readonly ContextMenuEntry[]
  accessibilityLabel: string
  backLabel: string
  testIDs: ContextMenuTestIDs
}

/** A button under the code, for what a long press or right-click on it would otherwise hide. */
export interface QrViewerAction {
  label: string
  icon: IconName
  onPress: () => void
  testID?: string | undefined
}

export interface QrViewerProps {
  /** What the code holds; null while closed. */
  value: string | null
  /** The same mark as the code on the page, so the full-screen code reads as the same one. */
  logo?: QrCodeProps['logo']
  onClose: () => void
  /** Names the code for a screen reader, and the press that closes it. */
  accessibilityLabel: string
  /** Names the close button. */
  closeLabel: string
  closeTestID?: string | undefined
  /** Opened on the code with a right-click or a long press; omitted where it offers nothing. */
  menu?: QrViewerMenu | undefined
  action?: QrViewerAction | undefined
  /** See `FullScreenModal`'s: so a Save or Share failure is seen while the code is still up. */
  toasts?: ReactNode | undefined
  testID?: string | undefined
}

export interface QrViewerBodyProps {
  value: string
  logo?: QrCodeProps['logo']
  width: number
  height: number
  /** What the hardware takes from the top and bottom of the window, so the controls clear it. */
  topInsetPx: number
  bottomInsetPx: number
  onClose: () => void
  accessibilityLabel: string
  closeLabel: string
  closeTestID?: string | undefined
  /** Where a right-click or long press on the code opens the menu; omitted where there is none. */
  onMenu?: ((anchor: MenuAnchor) => void) | undefined
  action?: QrViewerAction | undefined
  testID?: string | undefined
}

/**
 * What the viewer draws, at a given size: apart from its modal so the catalog can draw it.
 *
 * The close button and the action sit beside the press area rather than inside it: on the web a
 * click inside would reach the press area too, and close the viewer as it acted. The close button
 * is there because a press anywhere closing it is not something anyone can see.
 */
export function QrViewerBody({
  value,
  logo,
  width,
  height,
  topInsetPx,
  bottomInsetPx,
  onClose,
  accessibilityLabel,
  closeLabel,
  closeTestID,
  onMenu,
  action,
  testID,
}: QrViewerBodyProps) {
  const sizePx = Math.floor(Math.min(width, height) * WINDOW_SHARE)
  const code = (
    <QrCode value={value} sizePx={sizePx} logo={logo} accessibilityLabel={accessibilityLabel} />
  )
  return (
    <YStack width={width} height={height} position="relative" alignItems="center">
      <PressArea
        accessibilityLabel={accessibilityLabel}
        onPress={onClose}
        {...(testID === undefined ? {} : { testID })}
      >
        {() => (
          <YStack
            width={width}
            height={height}
            backgroundColor="$backgroundPrimary"
            alignItems="center"
            justifyContent="center"
          >
            {onMenu === undefined ? (
              code
            ) : (
              <ContextMenuTarget onOpen={onMenu}>{code}</ContextMenuTarget>
            )}
          </YStack>
        )}
      </PressArea>
      {/* Over the code rather than above it, so the code centres on the window. */}
      <YStack position="absolute" top={topInsetPx} left={0} right={0} pointerEvents="box-none">
        <FullScreenBar onClose={onClose} closeLabel={closeLabel} closeTestID={closeTestID} />
      </YStack>
      {action === undefined ? null : (
        // Only as wide as the button, centred by the parent, so a press beside it still closes.
        <YStack position="absolute" bottom={bottomInsetPx} padding="$lg">
          <Button
            variant="outlineAccent"
            {...(action.testID === undefined ? {} : { testID: action.testID })}
            onPress={action.onPress}
            icon={<Icon name={action.icon} size="md" color="$accentText" />}
          >
            {action.label}
          </Button>
        </YStack>
      )}
    </YStack>
  )
}

/**
 * A QR code filling most of the window, for a camera held at a distance: the close button, a press
 * anywhere but the action, or Escape closes it. Escape is the platform modal's own
 * `onRequestClose`, as for the host.
 */
export function QrViewer({
  value,
  logo,
  onClose,
  accessibilityLabel,
  closeLabel,
  closeTestID,
  menu,
  action,
  toasts,
  testID,
}: QrViewerProps) {
  const window = useWindowSize()
  const insets = useScreenInsets()
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null)
  // The last code shown, still drawn while the modal fades out (see `FullScreenModal`).
  const [drawn, setDrawn] = useState(value)
  if (value !== null && value !== drawn) setDrawn(value)

  return (
    <FullScreenModal open={value !== null} onClose={onClose} toasts={toasts}>
      {drawn === null ? null : (
        <QrViewerBody
          value={drawn}
          logo={logo}
          width={window.width}
          height={window.height}
          topInsetPx={insets.top}
          bottomInsetPx={insets.bottom}
          onClose={onClose}
          accessibilityLabel={accessibilityLabel}
          closeLabel={closeLabel}
          closeTestID={closeTestID}
          onMenu={menu === undefined ? undefined : setAnchor}
          action={action}
          testID={testID}
        />
      )}
      {menu === undefined ? null : (
        <ContextMenu
          anchor={anchor}
          onDismiss={() => {
            setAnchor(null)
          }}
          entries={menu.entries}
          accessibilityLabel={menu.accessibilityLabel}
          backLabel={menu.backLabel}
          testIDs={menu.testIDs}
        />
      )}
    </FullScreenModal>
  )
}
