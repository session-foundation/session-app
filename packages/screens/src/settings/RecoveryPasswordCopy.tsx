import { requirePorts } from '@session/app'
import { tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'
import { Button, useToast } from '@session/ui'

import type { RecoveryPasswordCopyProps } from './RecoveryPasswordCopy.types'

/** Copy, saying so with a toast, as the Account ID's copy does on the desktop. */
export function RecoveryPasswordCopy({ phrase }: RecoveryPasswordCopyProps) {
  const toasts = useToast()
  return (
    <Button
      variant="outline"
      fill
      testID={ELEMENT.recoveryPassword.copy}
      onPress={() => {
        void requirePorts()
          .clipboard.setSecret(phrase)
          .then(() => {
            // The same id as every other copy, so copying again shows it again rather than twice.
            toasts.show(tr('copied'), { id: 'copied-to-clipboard' })
          })
      }}
    >
      {tr('copy')}
    </Button>
  )
}
