import { ALBUM_WIDTH } from '@session/basic-types'
import type { Message } from '@session/client'
import { SPACE_SCALE, YStack } from '@session/ui'

import { AttachmentFooter, ROW_OVERHANG } from './AttachmentFooter'
import { AttachmentList, LIST_MAX_ROWS } from './AttachmentList'
import { AttachmentPill } from './AttachmentPill'
import { attachmentView, canChooseView } from './attachmentView'
import { useConversationUi } from './conversationUi'
import { MessageAlbum } from './MessageAlbum'
import { useAttachmentSet } from './useAttachmentSet'
import { useViewChoice } from './viewChoices'

/**
 * Everything one message's attachments draw: the album or the list, and the one footer under both.
 *
 * The footer is the set's, not either shape's - its count is every attachment, including the ones
 * behind "+N" that no tile shows.
 */
export function MessageAttachments({ message }: { message: Message }) {
  const ui = useConversationUi()
  const { set, fetchFor, act, downloadMissing } = useAttachmentSet(message)
  const view = attachmentView(message, useViewChoice(ui.views, message.id))
  const overflows = view === 'list' && message.attachments.length > LIST_MAX_ROWS

  // Once rather than per shape: a message with nothing attached would otherwise draw an empty
  // album, because "every attachment can be shown" is true of no attachments at all.
  if (message.attachments.length === 0) return null

  return (
    // One width in either shape: a bubble fits its content, so a list left to size itself gives
    // its names and the footer's total no width at all, and the bubble would resize on a toggle.
    // Capped at the bubble's inside, so where a pane is too narrow the list shrinks instead.
    // The gap clears the footer's overhang, so a tile or row is never under the footer's targets.
    <YStack gap={SPACE_SCALE['3xs'] + ROW_OVERHANG} width={ALBUM_WIDTH} maxWidth="100%">
      {view === 'gallery' ? (
        <MessageAlbum
          message={message}
          onAccent={message.outgoing}
          fetchFor={fetchFor}
          setState={set.state}
          // Opens only a picture that is here, as the legacy clients do. A tile is the whole set's,
          // so tapping one that is not fetches every attachment the album stands for.
          onOpen={(index) => {
            const tapped = message.attachments.find((a) => a.index === index)
            if (tapped !== undefined && fetchFor(tapped).state === 'ready')
              ui.openViewer(message.id, index)
            else downloadMissing()
          }}
          control={<AttachmentPill set={set} />}
        />
      ) : (
        <AttachmentList
          message={message}
          onAccent={message.outgoing}
          onShowAll={
            overflows
              ? () => {
                  ui.openSheet(message.id)
                }
              : undefined
          }
        />
      )}
      <AttachmentFooter
        set={set}
        onAccent={message.outgoing}
        onAction={act}
        view={canChooseView(message) ? view : undefined}
        onView={(chosen) => {
          ui.views.choose(message.id, chosen)
        }}
      />
    </YStack>
  )
}
