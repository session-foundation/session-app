import { flag, requirePorts } from '@session/app'
import { tr } from '@session/localization'
import { useSessionActions, type RecoveryPassword, type SessionActions } from '@session/state'
import { ELEMENT } from '@session/test-ids'
import {
  Button,
  RecoveryPasswordMark,
  SettingsGroup,
  SettingsRow,
  Swap,
  Text,
  useModals,
  useToast,
  useWindowSize,
  XStack,
  YStack,
  type Modals,
} from '@session/ui'
import { useEffect, useState } from 'react'

import { LocalizedText } from '../LocalizedText'
import { RecoveryPasswordCopy } from './RecoveryPasswordCopy'
import { ShareableQrCode } from './ShareableQrCode'

/** The shield beside the heading, at the clients' own size rather than a rung. */
const HEADING_MARK_SIZE = 20
/** The legacy desktop client's size for the code on the page; narrower on a narrow screen. */
const QR_SIZE_PX = 260
/** The card's padding and the page's, on both sides, which the code has to fit inside. */
const QR_INSET_PX = 64

/**
 * The final Yes: held while hiding, then back to Settings, where the row has gone, as every legacy
 * client does. A hide that fails closes the dialog and stays on the page, which still shows the
 * password, and says so.
 */
export function hideAndLeave(
  modals: Modals,
  id: string,
  hide: () => Promise<void>,
  failed: () => void,
): void {
  modals.lock(id)
  void hide().then(
    () => {
      modals.dismiss(id)
      modals.pop()
    },
    () => {
      modals.dismiss(id)
      failed()
    },
  )
}

/**
 * The second confirmation, with Cancel where the first had Continue, as the legacy iOS and desktop
 * clients put it: a second tap in the same place cancels rather than hiding for good.
 */
function confirmHideAgain(modals: Modals, hide: () => Promise<void>, failed: () => void): void {
  const id = modals.present({
    kind: 'alert',
    testID: ELEMENT.recoveryPassword.hideConfirm,
    showClose: false,
    initial: {
      title: tr('recoveryPasswordHidePermanently'),
      render: () => (
        <LocalizedText
          text={tr('recoveryPasswordHidePermanentlyDescription2')}
          size="$body"
          textAlign="center"
        />
      ),
      footer: () => (
        <>
          <Button
            variant="ghost"
            fill
            borderRadius="$none"
            testID={ELEMENT.recoveryPassword.hideCancel}
            onPress={() => {
              modals.dismiss(id)
            }}
          >
            {tr('cancel')}
          </Button>
          <Button
            variant="ghost"
            fill
            borderRadius="$none"
            destructive
            testID={ELEMENT.recoveryPassword.hideYes}
            onPress={() => {
              hideAndLeave(modals, id, hide, failed)
            }}
          >
            {tr('yes')}
          </Button>
        </>
      ),
    },
  })
}

function confirmHide(modals: Modals, hide: () => Promise<void>, failed: () => void): void {
  const id = modals.present({
    kind: 'alert',
    testID: ELEMENT.recoveryPassword.hideConfirm,
    showClose: false,
    initial: {
      title: tr('recoveryPasswordHidePermanently'),
      render: () => (
        <LocalizedText
          text={tr('recoveryPasswordHidePermanentlyDescription1')}
          size="$body"
          textAlign="center"
        />
      ),
      footer: () => (
        <>
          <Button
            variant="ghost"
            fill
            borderRadius="$none"
            destructive
            testID={ELEMENT.recoveryPassword.hideContinue}
            onPress={() => {
              modals.dismiss(id)
              confirmHideAgain(modals, hide, failed)
            }}
          >
            {tr('theContinue')}
          </Button>
          <Button
            variant="ghost"
            fill
            borderRadius="$none"
            testID={ELEMENT.recoveryPassword.hideCancel}
            onPress={() => {
              modals.dismiss(id)
            }}
          >
            {tr('cancel')}
          </Button>
        </>
      ),
    },
  })
}

/** The words as legacy draws them: monospaced, centred, in the accent's text colour, in a box. */
function Words({ words }: { words: string[] }) {
  return (
    <YStack
      borderWidth={1}
      borderColor="$separatorColor"
      borderRadius="$md"
      padding="$lg"
      alignSelf="stretch"
    >
      <Text
        size="$caption"
        fontFamily="$mono"
        color="$accentText"
        textAlign="center"
        selectable
        testID={ELEMENT.recoveryPassword.words}
      >
        {words.join(' ')}
      </Text>
    </YStack>
  )
}

/** Whether the row's load is under way, so a second press while it runs opens nothing more. */
let opening = false

/**
 * Opens the recovery password once it has loaded, as legacy iOS does: the page arrives laid out
 * rather than growing when the words come, and a failure is said in place of it.
 *
 * The words and the seed are held by the page alone, never in the store or a log: a string in
 * JavaScript cannot be wiped, so the fewer places hold one the better.
 */
export function openRecoveryPassword(modals: Modals, actions: SessionActions): void {
  if (opening) return
  opening = true
  // Kept out of screenshots, and the modal host's dialog made afresh, before the page is in it: a
  // tablet's Settings dialog takes the flag only when it is made, and the page must not draw a
  // frame in one made without. This hold ends once the page is pushed; the page takes its own,
  // and the flag outlasts its last holder long enough for the page to mount.
  const preventCapture = requirePorts().window.preventScreenCapture
  const secured =
    preventCapture === null
      ? Promise.resolve()
      : preventCapture(true).then(() => {
          modals.secureHost()
        })
  Promise.all([actions.getRecoveryPassword(), secured])
    .then(
      ([secret]) => {
        modals.push({
          title: tr('sessionRecoveryPassword'),
          render: () => <RecoveryPasswordPage secret={secret} />,
        })
      },
      () => {
        const id = modals.present({
          kind: 'alert',
          testID: ELEMENT.recoveryPassword.loadError,
          initial: {
            title: tr('theError'),
            render: () => (
              <Text size="$body" textAlign="center">
                {tr('recoveryPasswordErrorLoad')}
              </Text>
            ),
            footer: () => (
              <Button
                variant="ghost"
                fill
                borderRadius="$none"
                onPress={() => {
                  modals.dismiss(id)
                }}
              >
                {tr('okay')}
              </Button>
            ),
          },
        })
      },
    )
    .finally(() => {
      opening = false
      if (preventCapture !== null) void preventCapture(false)
    })
}

/**
 * The recovery password: the words, or the QR code of the seed they encode, and hiding it for
 * good. A child screen; the settings modal supplies the chrome. See `openRecoveryPassword`.
 */
export function RecoveryPasswordPage({
  secret,
  initialView = 'words',
}: {
  secret: RecoveryPassword
  /** Which the page opens on. The QR code is for the catalog, which has no press to get there. */
  initialView?: 'words' | 'qr' | undefined
}) {
  // TODO: the legacy desktop client asks for the app password before showing this, where one is
  // set. There is no app password yet; ask for it here once there is.
  const actions = useSessionActions()
  const modals = useModals()
  const toasts = useToast()
  const window = useWindowSize()
  const ports = requirePorts()
  const [showingQr, setShowingQr] = useState(initialView === 'qr')
  // Whether the words and the code have swapped since the page opened: the button that swaps back
  // takes the focus then, and only then, so opening the page does not move it.
  const [swapped, setSwapped] = useState(false)

  // Out of screenshots, recordings and the recents thumbnail while it is on screen, where the
  // platform offers that (Android). The modal host is drawn afresh after: on a tablet Settings is
  // in react-native's `Modal` dialog, which takes the flag only when it is made, and keeps it
  // until Settings closes.
  const preventCapture = ports.window.preventScreenCapture
  useEffect(() => {
    if (preventCapture === null) return
    // After the flag is on: a dialog made before it would not copy it.
    void preventCapture(true).then(() => {
      modals.secureHost()
    })
    return () => {
      void preventCapture(false)
    }
  }, [preventCapture, modals])

  const qrSizePx = Math.min(QR_SIZE_PX, window.width - QR_INSET_PX)

  return (
    <YStack padding="$md" gap="$lg">
      <SettingsGroup>
        <YStack padding="$md" gap="$md" alignItems="center">
          <XStack alignSelf="stretch" alignItems="center" gap="$xs">
            <Text size="$heading" weight="bold">
              {tr('sessionRecoveryPassword')}
            </Text>
            <RecoveryPasswordMark size={HEADING_MARK_SIZE} color="$textPrimary" />
          </XStack>
          <LocalizedText
            text={tr('recoveryPasswordDescription')}
            size="$body"
            alignSelf="stretch"
          />

          {/* Swapped as legacy Android swaps them: the arriving one fades in, held in place, as
              the box grows or shrinks between their heights. */}
          <Swap swapKey={showingQr ? 'qr' : 'words'} instant={flag('disableAnimations')}>
            {showingQr ? (
              <YStack alignSelf="stretch" gap="$md" alignItems="center">
                <ShareableQrCode
                  value={secret.seedHex}
                  sizePx={qrSizePx}
                  mark="recoveryPassword"
                  accessibilityLabel={tr('qrCode')}
                  testID={ELEMENT.recoveryPassword.qr}
                  fullScreenTestID={ELEMENT.recoveryPassword.qrFullScreen}
                />
                <XStack alignSelf="stretch">
                  <Button
                    variant="outline"
                    fill
                    testID={ELEMENT.recoveryPassword.viewWords}
                    focusOnMount={swapped}
                    onPress={() => {
                      setShowingQr(false)
                      setSwapped(true)
                    }}
                  >
                    {tr('recoveryPasswordView')}
                  </Button>
                </XStack>
              </YStack>
            ) : (
              <YStack alignSelf="stretch" gap="$md" alignItems="center">
                <Words words={secret.words} />
                <XStack alignSelf="stretch" gap="$md">
                  <RecoveryPasswordCopy phrase={secret.words.join(' ')} />
                  <Button
                    variant="outline"
                    fill
                    testID={ELEMENT.recoveryPassword.viewQr}
                    focusOnMount={swapped}
                    onPress={() => {
                      setShowingQr(true)
                      setSwapped(true)
                    }}
                  >
                    {tr('qrView')}
                  </Button>
                </XStack>
              </YStack>
            )}
          </Swap>
        </YStack>
      </SettingsGroup>

      <SettingsGroup>
        <SettingsRow
          label={tr('recoveryPasswordHideRecoveryPassword')}
          subtitle={tr('recoveryPasswordHideRecoveryPasswordDescription')}
          testID={ELEMENT.recoveryPassword.hideRow}
          wideTrailing
          trailing={
            <Button
              variant="danger"
              size="sm"
              testID={ELEMENT.recoveryPassword.hide}
              onPress={() => {
                confirmHide(modals, actions.hideRecoveryPassword, () => {
                  toasts.show(tr('errorGeneric'))
                })
              }}
            >
              {tr('hide')}
            </Button>
          }
        />
      </SettingsGroup>
    </YStack>
  )
}
