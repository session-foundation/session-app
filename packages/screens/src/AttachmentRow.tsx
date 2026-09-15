import { requirePorts } from '@session/app'
import type { Attachment, Message } from '@session/client'
import { tr } from '@session/localization'
import { useAttachmentTransfer, useSessionActions } from '@session/state'
import { ELEMENT } from '@session/test-ids'
import { Progress, Text, XStack, YStack } from '@session/ui'
import { useState } from 'react'

import { formatBytes } from './formatBytes'

/**
 * One attachment on one message.
 *
 * Nothing here knows whether the bytes are on this device, because nothing records it: asking
 * for them is the answer, and an attachment already in the cache is handed over at once with no
 * progress reported at all. So the row starts at "download" even for a file that is here, and
 * the tap that follows is instant.
 */
export function AttachmentRow({
  message,
  attachment,
  onFirstDownload,
}: {
  message: Message
  attachment: Attachment
  /** The conversation has never been asked what to fetch unprompted. Asked once, on first tap. */
  onFirstDownload?: () => void
}) {
  const actions = useSessionActions()
  const download = useAttachmentTransfer('download', message.id, attachment.index)
  const save = useAttachmentTransfer('save', message.id, attachment.index)
  const [error, setError] = useState(false)

  const running = download?.state === 'running'
  const failed = download?.state === 'failed' || error
  const ready = download?.state === 'done'

  // Absent while the server has not said how big the file is, which is what the first report of
  // every transfer means. An indeterminate bar rather than a full one or an empty one.
  const fraction = download && download.total > 0 ? download.done / download.total : undefined

  function start(): void {
    setError(false)
    onFirstDownload?.()
    void actions.downloadAttachment(message.id, attachment.index).catch(() => setError(true))
  }

  async function saveToDisk(): Promise<void> {
    const suggested = attachment.filename ?? `attachment-${String(attachment.index + 1)}`
    const destination = await requirePorts().files.chooseSaveLocation(suggested)
    if (destination === null) return
    const saved = await actions.saveAttachment(message.id, attachment.index, destination)
    await requirePorts().files.revealInFolder(saved)
  }

  const label = attachment.filename ?? tr('attachment')
  const size = attachment.size === undefined ? undefined : formatBytes(attachment.size)

  return (
    <YStack
      gap="$0.5"
      paddingVertical="$0.5"
      borderTopWidth={1}
      borderTopColor="$bordersColor"
      testID={ELEMENT.conversation.attachment}
    >
      <XStack alignItems="center" gap="$1" justifyContent="space-between">
        <Text size="$3" numberOfLines={1} testID={ELEMENT.conversation.attachmentName}>
          {label}
        </Text>
        {size === undefined ? null : (
          <Text size="$2" opacity={0.7}>
            {size}
          </Text>
        )}
      </XStack>

      <XStack alignItems="center" gap="$1">
        <Text size="$2" opacity={0.7} testID={ELEMENT.conversation.attachmentState}>
          {running
            ? tr('downloading')
            : failed
              ? tr('failedToDownload')
              : save?.state === 'running'
                ? tr('saving')
                : ''}
        </Text>
        {ready ? (
          <Text
            size="$2"
            weight="semibold"
            textDecorationLine="underline"
            testID={ELEMENT.conversation.attachmentSave}
            onPress={() => void saveToDisk()}
          >
            {tr('save')}
          </Text>
        ) : running ? null : (
          <Text
            size="$2"
            weight="semibold"
            textDecorationLine="underline"
            testID={ELEMENT.conversation.attachmentDownload}
            onPress={start}
          >
            {failed ? tr('retry') : tr('download')}
          </Text>
        )}
      </XStack>

      {running ? (
        <Progress
          {...(fraction === undefined ? {} : { value: fraction })}
          color="$messageBubbleIncomingText"
          trackColor="$backgroundTertiary"
          testID={ELEMENT.conversation.attachmentProgress}
        />
      ) : null}
    </YStack>
  )
}
