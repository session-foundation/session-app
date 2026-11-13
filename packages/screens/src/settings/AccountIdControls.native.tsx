import { requirePorts } from '@session/app'
import { tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'
import { Button, XStack } from '@session/ui'
import { useState } from 'react'

import { useTimeout } from '../useTimeout'

import { AccountIdText } from './AccountIdText'
import type { AccountIdControlsProps } from './AccountIdControls.types'

/** How long Copy says it worked. The button is held meanwhile, so a second press cannot undo it. */
const COPIED_FOR_MS = 4000

/**
 * The ID, then Share and Copy across the width the groups below take, split evenly.
 *
 * Share hands over the bare ID: sending the invitation is what Invite a Friend is for, and the two
 * controls would otherwise do the same thing.
 */
export function AccountIdControls({ sessionId }: AccountIdControlsProps) {
  const shareText = requirePorts().share.shareText
  const [copied, setCopied] = useState(false)
  const later = useTimeout()
  return (
    <>
      <AccountIdText sessionId={sessionId} />
      <XStack alignSelf="stretch" gap="$md">
        {shareText === null ? null : (
          <Button
            variant="outlineAccent"
            fill
            testID={ELEMENT.settings.shareAccountId}
            onPress={() => {
              void shareText(sessionId)
            }}
          >
            {tr('share')}
          </Button>
        )}
        <Button
          variant="outlineAccent"
          fill
          disabled={copied}
          testID={ELEMENT.settings.copyAccountId}
          onPress={() => {
            void requirePorts()
              .clipboard.setString(sessionId)
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
      </XStack>
    </>
  )
}
