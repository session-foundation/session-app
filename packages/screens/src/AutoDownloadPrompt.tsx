import { tr } from '@session/localization'
import { useSessionActions } from '@session/state'
import { ELEMENT } from '@session/test-ids'
import { Button, Text, XStack, YStack } from '@session/ui'

import { LocalizedText } from './LocalizedText'

/**
 * Asked the first time someone fetches an attachment in a conversation, and never again.
 *
 * Both answers are recorded, `no` included: calling the setter is what marks the question as
 * asked, and a client that stored "no" as "not asked" would put this on screen for ever.
 *
 * An overlay inside the screen rather than a portalled dialog, so it needs no portal host and
 * behaves the same on a phone and in a desktop pane.
 */
export function AutoDownloadPrompt({
  conversationId,
  conversationName,
  onAnswered,
}: {
  conversationId: string
  conversationName: string
  onAnswered: () => void
}) {
  const actions = useSessionActions()

  function answer(mode: 'all' | 'none'): void {
    onAnswered()
    void actions.setAutoDownload(conversationId, mode)
  }

  return (
    <YStack
      position="absolute"
      top={0}
      left={0}
      right={0}
      bottom={0}
      padding="$2"
      justifyContent="center"
      alignItems="center"
      backgroundColor="$backgroundPrimary"
      opacity={0.98}
      testID={ELEMENT.conversation.autoDownloadPrompt}
    >
      <YStack
        gap="$1.5"
        padding="$2"
        maxWidth={400}
        borderRadius="$3"
        borderWidth={1}
        borderColor="$bordersColor"
        backgroundColor="$backgroundSecondary"
      >
        <Text size="$5" weight="semibold">
          {tr('attachmentsAutoDownloadModalTitle')}
        </Text>
        <LocalizedText
          text={tr('attachmentsAutoDownloadModalDescription', {
            conversation_name: conversationName,
          })}
        />
        <XStack gap="$1.5" justifyContent="flex-end">
          <Button
            variant="outline"
            size="md"
            testID={ELEMENT.conversation.autoDownloadNo}
            onPress={() => answer('none')}
          >
            {tr('no')}
          </Button>
          <Button
            size="md"
            testID={ELEMENT.conversation.autoDownloadYes}
            onPress={() => answer('all')}
          >
            {tr('yes')}
          </Button>
        </XStack>
      </YStack>
    </YStack>
  )
}
