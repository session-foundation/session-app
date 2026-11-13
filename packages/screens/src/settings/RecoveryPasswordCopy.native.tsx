import { requirePorts } from '@session/app'
import { tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'
import { Button } from '@session/ui'
import { useState } from 'react'

import { useTimeout } from '../useTimeout'

import type { RecoveryPasswordCopyProps } from './RecoveryPasswordCopy.types'

/** How long Copy says it worked, as the Account ID's does. Held meanwhile. */
const COPIED_FOR_MS = 4000

/**
 * Copy, saying so on the button as the Account ID's copy does on a phone. Copied as a secret,
 * which Android 13 and later keep out of their clipboard preview.
 */
export function RecoveryPasswordCopy({ phrase }: RecoveryPasswordCopyProps) {
  const [copied, setCopied] = useState(false)
  const later = useTimeout()
  return (
    <Button
      variant="outline"
      fill
      disabled={copied}
      testID={ELEMENT.recoveryPassword.copy}
      onPress={() => {
        void requirePorts()
          .clipboard.setSecret(phrase)
          .then(() => {
            setCopied(true)
            later(() => {
              setCopied(false)
            }, COPIED_FOR_MS)
          })
      }}
    >
      {copied ? tr('copied') : tr('copy')}
    </Button>
  )
}
