import type { Attachment, AutoDownload, Message } from '@session/client'
import { transferKey, useAttachmentTransfers, useSessionActions } from '@session/state'
import { YStack } from '@session/ui'

import { AttachmentFooter } from './AttachmentFooter'
import { AttachmentRow } from './AttachmentRow'
import { summarise, type AttachmentSet } from './attachmentSet'
import { MessageAlbum } from './MessageAlbum'
import { saveOne } from './saveAttachment'
import { viewableAttachments } from './viewableAttachments'

/**
 * Everything one message's attachments draw: the album, the rows, and the one footer under both.
 *
 * The footer is the set's, not the album's - its count is every attachment, including the ones
 * behind "+N" that no tile shows.
 */
export function MessageAttachments({
  message,
  onOpen,
  onFirstDownload,
  autoDownload,
}: {
  message: Message
  onOpen: (at: number) => void
  onFirstDownload?: (() => void) | undefined
  /** What this conversation fetches unasked. Undefined means nobody has been asked. */
  autoDownload?: AutoDownload | undefined
}) {
  const actions = useSessionActions()
  const set = useAttachmentSet(message)
  const viewable = viewableAttachments(message)
  const files = message.attachments.filter((attachment) => !viewable.includes(attachment))

  function act(): void {
    if (set.state === 'ready') {
      // Exactly one, or the footer would not have offered this - see `verb`.
      const only = message.attachments[0]
      if (only !== undefined) void saveOne(message, only.index, actions)
      return
    }
    // Every attachment, whether or not a tile is drawing it. Download and retry are the same call:
    // one that is already cached is handed over at once.
    for (const attachment of message.attachments) {
      void actions.downloadAttachment(message.id, attachment.index)
    }
  }

  return (
    <YStack gap="$3xs">
      {viewable.length === 0 ? null : <MessageAlbum message={message} onOpen={onOpen} autoDownload={autoDownload} />}
      {files.map((attachment) => (
        <AttachmentRow
          key={attachment.index}
          message={message}
          attachment={attachment}
          {...(onFirstDownload === undefined ? {} : { onFirstDownload })}
        />
      ))}
      {message.attachments.length === 0 ? null : <AttachmentFooter set={set} onAction={act} />}
    </YStack>
  )
}

/**
 * The set's state, folded from every transfer this session has seen.
 *
 * The record is read once rather than a hook per attachment: a hook in a loop is fine while a
 * message's attachment list cannot change, and that is a rule nobody should have to check.
 */
function useAttachmentSet(message: Message): AttachmentSet {
  const transfers = useAttachmentTransfers()
  return summarise(message, (attachment: Attachment) =>
    transfers[transferKey('download', message.id, attachment.index)],
  )
}
