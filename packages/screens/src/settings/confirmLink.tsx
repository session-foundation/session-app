import { openExternalUrl, requirePorts } from '@session/app'
import { tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'
import { Button, type Modals } from '@session/ui'

import { LinkAddress } from '../LinkAddress'

/**
 * Asks before handing an address to the browser. Every external link must go through this.
 * Presented over whatever is open, so the caller holds no dialog state.
 */
export function confirmLink(modals: Modals, url: string): void {
  const id = modals.present({
    kind: 'alert',
    testID: ELEMENT.onboarding.openUrlDialog,
    closeTestID: ELEMENT.onboarding.openUrlCancel,
    initial: {
      title: tr('urlOpen'),
      render: () => <LinkAddress url={url} />,
      footer: () => (
        <>
          <Button
            // Ghost, not simple, so the whole cell highlights when held.
            variant="ghost"
            fill
            // The actions share edges across the dialog, so a rounded highlight would leave gaps.
            borderRadius="$none"
            // Leaving is the irreversible half.
            destructive
            testID={ELEMENT.onboarding.openUrlConfirm}
            onPress={() => {
              void openExternalUrl(url)
              modals.dismiss(id)
            }}
          >
            {tr('open')}
          </Button>
          <Button
            variant="ghost"
            fill
            borderRadius="$none"
            testID={ELEMENT.onboarding.copyUrl}
            onPress={() => {
              void requirePorts().clipboard.setString(url)
              modals.dismiss(id)
            }}
          >
            {tr('urlCopy')}
          </Button>
        </>
      ),
    },
  })
}
