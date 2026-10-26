import { tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'
import { Button, Icon, PressArea, XStack, YStack } from '@session/ui'

import { useCopyWithToast } from '../useCopyWithToast'
import { AccountIdText } from './AccountIdText'
import type { AccountIdControlsProps } from './AccountIdControls.types'

/**
 * The ID with a copy glyph at its trailing side, centred on its three lines. The ID copies when
 * pressed as well, and either raises the same toast.
 */
export function AccountIdControls({ sessionId }: AccountIdControlsProps) {
  const copyWithToast = useCopyWithToast()
  const copy = () => {
    copyWithToast(sessionId)
  }
  return (
    <XStack alignItems="center" gap="$xs">
      <PressArea accessibilityLabel={tr('copy')} onPress={copy}>
        {() => (
          <YStack $platform-web={{ cursor: 'pointer' }}>
            <AccountIdText sessionId={sessionId} />
          </YStack>
        )}
      </PressArea>
      <Button
        variant="ghost"
        size="xs"
        circular
        accessibilityLabel={tr('copy')}
        testID={ELEMENT.settings.copyAccountId}
        onPress={copy}
        icon={<Icon name="copy" size="sm" color="$accentText" />}
      />
    </XStack>
  )
}
