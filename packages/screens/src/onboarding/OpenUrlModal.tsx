import { openExternalUrl, requirePorts } from '@session/app'
import { tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'
import { Button, Modal } from '@session/ui'
import { useEffect, useRef } from 'react'

import { LinkAddress } from '../LinkAddress'

interface OpenUrlModalProps {
  /** The address to confirm, or null when the dialog is closed. */
  url: string | null
  onClose: () => void
}

/**
 * Confirming a link before leaving for the browser.
 *
 * Two actions, both text, as the client draws them: **Open** in danger red and **Copy URL** plain.
 * Red on the one that leaves, because leaving is the irreversible half -- and this dialog exists at
 * all because the app is about to hand an address to another program.
 */
export function OpenUrlModal({ url, onClose }: OpenUrlModalProps) {
  /**
   * The last address shown, kept after `url` goes null.
   *
   * The dialog fades out rather than vanishing, and clearing the text at the same moment emptied
   * it mid-animation -- the box collapsed while it was still visible, which reads as a glitch
   * rather than a dismissal. So the body keeps rendering what it was showing until it is gone.
   */
  const shown = useRef<string>('')
  useEffect(() => {
    if (url !== null) shown.current = url
  }, [url])

  return (
    <Modal
      open={url !== null}
      onClose={onClose}
      title={tr('urlOpen')}
      closeLabel={tr('close')}
      testID={ELEMENT.onboarding.openUrlDialog}
      closeTestID={ELEMENT.onboarding.openUrlCancel}
      actions={
        <>
          <Button
            // Ghost rather than simple: a dialog's action highlights its whole cell when held,
            // the way the clients' do, where `simple` dims the label and leaves the cell alone.
            variant="ghost"
            fill
            // A cell, not a pill: the actions run the full width of the dialog and share an edge,
            // so a rounded highlight would sit inside its cell with a gap all round it.
            borderRadius="$none"
            destructive
            testID={ELEMENT.onboarding.openUrlConfirm}
            onPress={() => {
              if (url !== null) void openExternalUrl(url)
              onClose()
            }}
          >
            {tr('open')}
          </Button>
          <Button
            variant="ghost"
            fill
            // A cell, not a pill: the actions run the full width of the dialog and share an edge,
            // so a rounded highlight would sit inside its cell with a gap all round it.
            borderRadius="$none"
            testID={ELEMENT.onboarding.copyUrl}
            onPress={() => {
              if (url !== null) void requirePorts().clipboard.setString(url)
              onClose()
            }}
          >
            {tr('urlCopy')}
          </Button>
        </>
      }
    >
      <LinkAddress url={url ?? shown.current} />
    </Modal>
  )
}
