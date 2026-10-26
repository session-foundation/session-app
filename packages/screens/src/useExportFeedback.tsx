import { requirePorts, type ExportAccess } from '@session/app'
import { tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'
import { Button, useModals, useToast, type Modals } from '@session/ui'

import type { ExportFeedback } from './exportAttachment'
import { LocalizedText } from './LocalizedText'

function AccessActions({ modals, id }: { modals: Modals; id: string }) {
  const openSettings = requirePorts().linking.openAppSettings
  return (
    <>
      {openSettings === null ? null : (
        <Button
          variant="ghost"
          fill
          borderRadius="$none"
          testID={ELEMENT.conversation.exportAccessSettings}
          onPress={() => {
            modals.dismiss(id)
            void openSettings()
          }}
        >
          {tr('sessionSettings')}
        </Button>
      )}
      <Button
        variant="ghost"
        fill
        borderRadius="$none"
        testID={ELEMENT.conversation.exportAccessCancel}
        onPress={() => {
          modals.dismiss(id)
        }}
      >
        {tr('cancel')}
      </Button>
    </>
  )
}

/**
 * Says why an export cannot go where it should: the access it needs was refused, and the app's
 * page in the system settings, which this offers to open, can grant it.
 */
function explainAccessRefused(modals: Modals, access: ExportAccess): void {
  const id = modals.present({
    kind: 'alert',
    testID: ELEMENT.conversation.exportAccessDialog,
    showClose: false,
    initial: {
      title: tr('permissionsRequired'),
      render: () => (
        <LocalizedText
          text={tr(access === 'storage' ? 'permissionsStorageDeniedLegacy' : 'permissionsLibrary')}
          size="$body"
          textAlign="center"
        />
      ),
      footer: () => <AccessActions modals={modals} id={id} />,
    },
  })
}

/** `exportOne`'s feedback: an alert for a refused access, else a toast. */
export function useExportFeedback(): ExportFeedback {
  const modals = useModals()
  const toasts = useToast()
  return {
    accessRefused: (access) => {
      explainAccessRefused(modals, access)
    },
    failed: () => {
      // One id, so a second failure shows the toast afresh rather than stacking another.
      toasts.show(tr('attachmentsSaveError'), { id: 'export-failed' })
    },
  }
}
