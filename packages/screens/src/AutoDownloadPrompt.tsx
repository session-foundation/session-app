import type { AutoDownload } from '@session/client'
import { tr } from '@session/localization'
import { useSessionActions } from '@session/state'
import { ELEMENT } from '@session/test-ids'
import { Button, Modal, RadioIndicator, Text, XStack, YStack } from '@session/ui'
import { useState } from 'react'

import { LocalizedText } from './LocalizedText'
import { PENDING_COPY } from './pendingCopy'

/** What Yes fetches: both of libsession's settings that fetch anything. */
type Scope = Exclude<AutoDownload, 'none'>

const SCOPES: readonly { value: Scope; label: string }[] = [
  { value: 'all', label: PENDING_COPY.autoDownloadAllFiles },
  { value: 'image-attachments', label: PENDING_COPY.autoDownloadImagesOnly },
]

function ScopeOption({
  label,
  selected,
  onSelect,
  testID,
}: {
  label: string
  selected: boolean
  onSelect: () => void
  testID: string
}) {
  return (
    <XStack
      role="radio"
      aria-checked={selected}
      alignItems="center"
      gap="$sm"
      paddingVertical="$xs"
      $platform-web={{ cursor: 'pointer' }}
      onPress={onSelect}
      testID={testID}
    >
      <Text size="$body" flex={1}>
        {label}
      </Text>
      <RadioIndicator selected={selected} />
    </XStack>
  )
}

/**
 * Asked the first time someone fetches an attachment in a conversation, and never again.
 *
 * Both answers are recorded, `no` included: calling the setter is what marks the question as
 * asked, and a client that stored "no" as "not asked" would put this on screen for ever.
 *
 * **A dialog rather than an overlay inside the screen.** An absolutely positioned cover resolves
 * its offsets against the nearest containing block, which on the web is the page unless a stack
 * says otherwise. `Modal` puts up its own surface, with nothing to resolve against.
 *
 * No cross, and not dismissible by a tap outside: this asks a question, and a third unlabelled
 * answer beside Yes and No is not one of the choices. All files is preselected, because that is
 * what the question itself asks about.
 */
export function AutoDownloadPrompt({
  open,
  conversationId,
  conversationName,
  onAnswered,
}: {
  open: boolean
  conversationId: string
  conversationName: string
  onAnswered: () => void
}) {
  const actions = useSessionActions()
  const [scope, setScope] = useState<Scope>('all')

  function answer(mode: AutoDownload): void {
    onAnswered()
    void actions.setAutoDownload(conversationId, mode)
  }

  return (
    <Modal
      open={open}
      // Unreachable while `showClose` is false, which turns dismissal off with it - but a dialog
      // closed some other way has still been answered, and no is the answer that changes least.
      onClose={() => {
        answer('none')
      }}
      title={tr('attachmentsAutoDownloadModalTitle')}
      closeLabel={tr('no')}
      showClose={false}
      testID={ELEMENT.conversation.autoDownloadPrompt}
      closeTestID={ELEMENT.conversation.autoDownloadClose}
      actions={
        <>
          <Button
            variant="ghost"
            fill
            borderRadius="$none"
            testID={ELEMENT.conversation.autoDownloadYes}
            onPress={() => {
              answer(scope)
            }}
          >
            {tr('yes')}
          </Button>
          <Button
            variant="ghost"
            fill
            borderRadius="$none"
            testID={ELEMENT.conversation.autoDownloadNo}
            onPress={() => {
              answer('none')
            }}
          >
            {tr('no')}
          </Button>
        </>
      }
    >
      <YStack gap="$sm">
        <LocalizedText
          text={tr('attachmentsAutoDownloadModalDescription', {
            conversation_name: conversationName,
          })}
        />
        <YStack role="radiogroup">
          {SCOPES.map((option) => (
            <ScopeOption
              key={option.value}
              label={option.label}
              selected={scope === option.value}
              onSelect={() => {
                setScope(option.value)
              }}
              testID={ELEMENT.conversation.autoDownloadOption(option.value)}
            />
          ))}
        </YStack>
      </YStack>
    </Modal>
  )
}
