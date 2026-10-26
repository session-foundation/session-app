import { requirePorts, useCamera } from '@session/app'
import { tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'
import { Button, Modal, ScannerFrame, Text, useMedia, useScreenInsets, YStack } from '@session/ui'
import { useCallback, useRef, useState, type ReactNode } from 'react'

/** How far the message floats above the home indicator. */
const MESSAGE_LIFT = 16

interface ScanQrPaneProps {
  /** A scanned code, as read. Whether it is a recovery seed is not this pane's to decide. */
  onScan: (value: string) => void
  /**
   * Whether this pane is the one being looked at.
   *
   * The pager keeps both mounted so a half-typed phrase survives a look at the other tab, so
   * being mounted is not being shown -- and a camera left running behind the phrase field lights
   * the platform's recording indicator while somebody types their recovery phrase.
   */
  showing?: boolean
  /** Shown under the frame. The bridge's refusal of whatever was scanned. */
  error?: string | null
  /**
   * Whether the pane sits in a column that scrolls, which has no height for the preview to fill,
   * so the preview is square instead.
   */
  fitsPage?: boolean
}

/**
 * The other way into a restore: point the camera at somebody else's recovery QR.
 *
 * **Until access is granted it says why it needs the camera and offers Continue.** Continue asks
 * for access while the platform will still ask; once it is refused for good, asking does nothing,
 * so Continue explains where it can be changed and offers the app's settings page instead.
 */
export function ScanQrPane({
  onScan,
  showing = true,
  error = null,
  fitsPage = false,
}: ScanQrPaneProps) {
  const camera = useCamera()
  const [settingsPrompt, setSettingsPrompt] = useState(false)
  const insets = useScreenInsets()
  const wide = useMedia().gtSm
  /**
   * The code this pane has already handed over.
   *
   * **A scanner reports every frame a code decodes in, not the first.** Holding the camera over
   * one is thirty reads a second, and each one starts a restore of the same seed -- so the first
   * wins and every loser reports a failure over a camera that scanned correctly. Latched on the
   * value rather than on a flag, so a different code is still read if the camera is moved.
   */
  const handed = useRef<string | null>(null)
  const handleScan = useCallback(
    (value: string) => {
      if (handed.current === value) return
      handed.current = value
      onScan(value)
    },
    [onScan],
  )

  if (camera === null) {
    // Desktop. Nothing to offer and nothing to ask for, so the pane says what is true rather than
    // showing a control that cannot work.
    return <Message testID={ELEMENT.onboarding.scanQrPane} text={tr('cameraGrantAccessQr')} />
  }

  if (camera.access === 'granted') {
    return (
      /**
       * **To the bottom of the window on a phone, and a rounded panel on the wide designs.**
       *
       * A phone camera that stops at the content box leaves a black bar along the bottom, which
       * reads as the preview having failed rather than as the device's own furniture -- so it
       * bleeds past its own edge into the home indicator's room.
       *
       * The wide designs centre a column, so there is no edge to reach and nothing to bleed into:
       * the bleed there would only push the frame off centre inside what is actually visible. A
       * preview floating in the middle of a column wants a corner radius instead, which is what
       * says deliberate rather than clipped.
       */
      <YStack
        // Square where it sets its own height, which is the shape of the frame drawn over it.
        {...(fitsPage ? { aspectRatio: 1 } : { flex: 1 })}
        overflow="hidden"
        {...(wide ? { borderRadius: '$lg' as const } : { marginBottom: -insets.bottom })}
        testID={ELEMENT.onboarding.scanQrPane}
      >
        <camera.Preview
          onScan={handleScan}
          active={showing}
          testID={ELEMENT.onboarding.scanQrPreview}
        />
        <ScannerFrame />
        {/* Over the picture rather than under it, which is where the client puts it -- a row
            beneath would take a strip of the preview away permanently for a message that is
            usually not there. On its own surface, because red on whatever the camera happens to be
            pointed at is not reliably readable. */}
        {error === null ? null : (
          <YStack
            position="absolute"
            left="$xl"
            right="$xl"
            bottom={insets.bottom + MESSAGE_LIFT}
            pointerEvents="none"
            alignItems="center"
            paddingHorizontal="$xl"
            paddingVertical="$md"
            borderRadius="$lg"
            backgroundColor="$backgroundSecondary"
          >
            <Text tone="danger" size="$label" weight="bold" textAlign="center">
              {error}
            </Text>
          </YStack>
        )}
      </YStack>
    )
  }

  const close = () => {
    setSettingsPrompt(false)
  }

  return (
    <>
      <Message
        testID={ELEMENT.onboarding.scanQrPane}
        text={tr('cameraGrantAccessQr')}
        action={
          <Button
            variant="ghostAccent"
            testID={ELEMENT.onboarding.cameraAccess}
            onPress={() => {
              if (camera.access === 'blocked') setSettingsPrompt(true)
              else void camera.request()
            }}
          >
            {tr('theContinue')}
          </Button>
        }
      />
      <Modal
        open={settingsPrompt}
        onClose={close}
        title={tr('cameraAccessRequired')}
        closeLabel={tr('close')}
        showClose={false}
        testID={ELEMENT.onboarding.cameraSettingsDialog}
        closeTestID={ELEMENT.onboarding.cameraSettingsCancel}
        actions={
          <>
            <Button
              variant="ghost"
              fill
              borderRadius="$none"
              testID={ELEMENT.onboarding.cameraSettingsOpen}
              onPress={() => {
                close()
                void requirePorts().linking.openAppSettings?.()
              }}
            >
              {tr('sessionSettings')}
            </Button>
            <Button
              variant="ghost"
              fill
              borderRadius="$none"
              testID={ELEMENT.onboarding.cameraSettingsCancel}
              onPress={close}
            >
              {tr('cancel')}
            </Button>
          </>
        }
      >
        <Text size="$body" textAlign="center">
          {tr('cameraAccessInstructions')}
        </Text>
      </Modal>
    </>
  )
}

/** The pane with nothing to show through: a line of explanation, centred, and maybe a control. */
function Message({ text, action, testID }: { text: string; action?: ReactNode; testID: string }) {
  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      gap="$md"
      paddingHorizontal="$3xl"
      testID={testID}
    >
      <Text textAlign="center">{text}</Text>
      {action}
    </YStack>
  )
}
