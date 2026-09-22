import type { AutoDownload, Message } from '@session/client'
import { YStack } from '@session/ui'

import { AttachmentRow } from './AttachmentRow'
import { viewerIndices } from './viewableAttachments'

/**
 * Every attachment on one message, as rows.
 *
 * Message order, every attachment, pictures included: the set is one object and a list that drew
 * only the documents would be the second half of a message whose first half is a gallery.
 *
 * Each row carries its own state, its own progress and its own control - which is what the album
 * cannot do, because a tile has nowhere to put one.
 */
export function AttachmentList({
  message,
  onOpen,
  onFirstDownload,
  autoDownload,
}: {
  message: Message
  /** Takes a position in the viewer's set, not in the message. See `viewerIndices`. */
  onOpen: (at: number) => void
  onFirstDownload?: (() => void) | undefined
  /** What this conversation fetches unasked. Undefined means nobody has been asked. */
  autoDownload?: AutoDownload | undefined
}) {
  const viewer = viewerIndices(message)

  return (
    <YStack>
      {message.attachments.map((attachment) => {
        const at = viewer.get(attachment.index)
        return (
          <AttachmentRow
            key={attachment.index}
            message={message}
            attachment={attachment}
            onFirstDownload={onFirstDownload}
            autoDownload={autoDownload}
            {...(at === undefined
              ? {}
              : {
                  onOpen: () => {
                    onOpen(at)
                  },
                })}
          />
        )
      })}
    </YStack>
  )
}
