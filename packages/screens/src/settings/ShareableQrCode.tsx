import { requirePorts } from '@session/app'
import type { QrMark } from '@session/basic-types'
import { tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'
import {
  ContextMenu,
  ContextMenuTarget,
  PressArea,
  QrCode,
  QrViewer,
  RecoveryPasswordMark,
  type MenuAnchor,
  useToast,
  type QrCodeProps,
} from '@session/ui'
import { useState } from 'react'

import { ToastLayer } from '../ToastLayer'

type ShareableQrCodeProps = Pick<
  QrCodeProps,
  'value' | 'sizePx' | 'accessibilityLabel' | 'testID'
> & {
  /** Drawn in the code on the page, full screen, and in the PNG it is saved or shared as. */
  mark?: QrMark | undefined
  fullScreenTestID: string
}

const MARK_GLYPHS = { recoveryPassword: RecoveryPasswordMark } as const satisfies Record<
  QrMark,
  QrCodeProps['logo']
>

/**
 * A QR code with what each platform can do with it. A press opens it full screen. On desktop a
 * right-click there saves it; on the phones a Share button under it, or a long press on the code
 * on the page, opens the share sheet, from which it can be saved to Files. A platform with neither
 * draws the code alone.
 *
 * The menu and the full-screen viewer are platform modals, so where this sits in a layout places
 * only the code.
 */
export function ShareableQrCode({
  value,
  sizePx,
  mark,
  accessibilityLabel,
  testID,
  fullScreenTestID,
}: ShareableQrCodeProps) {
  const logo = mark === undefined ? undefined : MARK_GLYPHS[mark]
  const ports = requirePorts()
  const toasts = useToast()
  const saveQrCode = ports.files.saveQrCode
  const shareQrCode = ports.share.shareQrCode
  const [shareMenu, setShareMenu] = useState<MenuAnchor | null>(null)
  const [fullScreen, setFullScreen] = useState(false)

  const qr = (
    <QrCode
      value={value}
      sizePx={sizePx}
      logo={logo}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    />
  )

  if (saveQrCode !== null)
    return (
      <>
        <PressArea
          accessibilityLabel={accessibilityLabel}
          onPress={() => {
            setFullScreen(true)
          }}
        >
          {() => qr}
        </PressArea>
        <QrViewer
          toasts={<ToastLayer />}
          value={fullScreen ? value : null}
          logo={logo}
          onClose={() => {
            setFullScreen(false)
          }}
          accessibilityLabel={accessibilityLabel}
          closeLabel={tr('close')}
          closeTestID={ELEMENT.qrViewer.close}
          testID={fullScreenTestID}
          menu={{
            entries: [
              {
                id: 'save',
                kind: 'action',
                label: tr('save'),
                icon: 'download',
                testID: ELEMENT.contextMenu.item('save'),
                onSelect: () => {
                  void saveQrCode(value, mark ?? null).catch(() => {
                    toasts.show(tr('attachmentsSaveError'))
                  })
                },
              },
            ],
            accessibilityLabel,
            backLabel: tr('back'),
            testIDs: ELEMENT.contextMenu,
          }}
        />
      </>
    )

  if (shareQrCode === null) return qr

  return (
    <>
      <ContextMenuTarget onOpen={setShareMenu}>
        <PressArea
          accessibilityLabel={accessibilityLabel}
          onPress={() => {
            setFullScreen(true)
          }}
        >
          {() => qr}
        </PressArea>
      </ContextMenuTarget>
      <QrViewer
        toasts={<ToastLayer />}
        value={fullScreen ? value : null}
        logo={logo}
        onClose={() => {
          setFullScreen(false)
        }}
        accessibilityLabel={accessibilityLabel}
        closeLabel={tr('close')}
        closeTestID={ELEMENT.qrViewer.close}
        testID={fullScreenTestID}
        action={{
          label: tr('share'),
          icon: 'share2',
          testID: ELEMENT.qrViewer.share,
          onPress: () => {
            void shareQrCode(value, mark ?? null).catch(() => {
              toasts.show(tr('errorGeneric'))
            })
          },
        }}
      />
      <ContextMenu
        anchor={shareMenu}
        onDismiss={() => {
          setShareMenu(null)
        }}
        entries={[
          {
            id: 'share',
            kind: 'action',
            label: tr('share'),
            icon: 'share2',
            testID: ELEMENT.contextMenu.item('share'),
            onSelect: () => {
              void shareQrCode(value, mark ?? null).catch(() => {
                toasts.show(tr('errorGeneric'))
              })
            },
          },
        ]}
        accessibilityLabel={accessibilityLabel}
        backLabel={tr('back')}
        testIDs={ELEMENT.contextMenu}
      />
    </>
  )
}
