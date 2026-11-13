import type { Attachment, Message } from '@session/client'
import { YStack } from '@session/ui'
import { useSessionActions } from '@session/state'

import { AttachmentFooter, FOOTER_CLEARANCE } from './AttachmentFooter'
import { AttachmentList, LIST_MAX_ROWS } from './AttachmentList'
import { attachmentView, canChooseView } from './attachmentView'
import { useConversationUi } from './conversationUi'
import { exportOne } from './exportAttachment'
import { MessageAlbum } from './MessageAlbum'
import { canReply } from './quotedReply'
import { isUploadPhase, whileSending } from './uploadState'
import { useAttachmentFooter } from './useAttachmentFooter'
import { useAlbumGeometry } from './useAlbumGeometry'
import { useAttachmentSet } from './useAttachmentSet'
import { useExportFeedback } from './useExportFeedback'
import { viewerFit } from './viewableAttachments'

/**
 * Everything one message's attachments draw: the album or the list, and the one footer under both.
 *
 * The footer is the set's, not either shape's - its count is every attachment, including the ones
 * behind "+N" that no tile shows.
 */
export function MessageAttachments({
  message,
  width,
}: {
  message: Message
  /** How wide the attachments and their footer are drawn: see `attachmentsWidthPx`. */
  width: number
}) {
  const ui = useConversationUi()
  const actions = useSessionActions()
  const feedback = useExportFeedback()
  const attachmentSet = useAttachmentSet(message)
  const { set, fetchFor, downloadMissing } = attachmentSet
  const footer = useAttachmentFooter(message, attachmentSet)
  const geometry = useAlbumGeometry()
  const albumWidth = width
  const view = attachmentView(message)
  const overflows = view === 'list' && message.attachments.length > LIST_MAX_ROWS
  const sending = isUploadPhase(message)
  const albumFetch = sending
    ? (attachment: Attachment) => whileSending(fetchFor(attachment))
    : fetchFor

  // Once rather than per shape: a message with nothing attached would otherwise draw an empty
  // album, because "every attachment can be shown" is true of no attachments at all.
  if (message.attachments.length === 0) return null

  return (
    // One width in either shape: a bubble fits its content, so a list left to size itself gives
    // its names and the footer's total no width at all, and the bubble would resize on a toggle.
    // Capped at the bubble's inside, so where a pane is too narrow the list shrinks instead.
    // The gap clears the footer's overhang, so a tile or row is never under the footer's targets.
    <YStack gap={FOOTER_CLEARANCE} width={albumWidth} maxWidth="100%">
      {view === 'gallery' ? (
        // Centred where the footer's least is wider than the one narrow picture above it.
        <YStack alignItems="center">
          <MessageAlbum
            message={message}
            // The layout's own width: a narrow picture comes out narrower than it, not the reverse.
            width={geometry.widthPx}
            loneMaxHeightPx={geometry.loneMaxHeightPx}
            onAccent={message.outgoing}
            fetchFor={albumFetch}
            setState={set.state}
            onReply={
              canReply(message)
                ? () => {
                    ui.reply(message.id)
                  }
                : undefined
            }
            // Opens only a picture that is here, as the legacy clients do, and exports one sent as
            // the original file. A tile is the whole set's, so tapping one that is not here fetches
            // every attachment the album stands for.
            onOpen={(index) => {
              const tapped = message.attachments.find((a) => a.index === index)
              if (tapped !== undefined && albumFetch(tapped).state === 'ready') {
                const fit = viewerFit(tapped)
                if (fit !== 'exports') ui.openViewer(message.id, index)
                else if (!sending) void exportOne(message, index, actions, feedback)
              } else if (!sending) downloadMissing()
            }}
          />
        </YStack>
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
        onAction={footer.onAction}
        sending={footer.sending}
        view={canChooseView(message) ? view : undefined}
        onView={(chosen) => {
          // Nothing redraws until libsession announces it, so a failure still shows what is stored.
          void actions.setGallery(message.id, chosen === 'gallery').catch(() => undefined)
        }}
      />
    </YStack>
  )
}
