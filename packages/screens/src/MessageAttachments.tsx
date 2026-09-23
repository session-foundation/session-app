import type { Attachment, AutoDownload, Message } from '@session/client'
import { tr } from '@session/localization'
import { transferKey, useAttachmentTransfers, useSessionActions } from '@session/state'
import { ELEMENT } from '@session/test-ids'
import { Sheet, YStack } from '@session/ui'
import { useState } from 'react'

import { AttachmentFooter } from './AttachmentFooter'
import { AttachmentList, LIST_MAX_ROWS } from './AttachmentList'
import { AttachmentPill } from './AttachmentPill'
import { summarise, type AttachmentSet } from './attachmentSet'
import { attachmentView, canChooseView, type AttachmentView } from './attachmentView'
import { MessageAlbum } from './MessageAlbum'
import { exportOne } from './exportAttachment'

/**
 * Everything one message's attachments draw: the album or the list, and the one footer under both.
 *
 * The footer is the set's, not either shape's - its count is every attachment, including the ones
 * behind "+N" that no tile shows.
 */
export function MessageAttachments({
  message,
  onOpen,
  onFirstDownload,
  autoDownload,
  chosenView,
  onChooseView,
}: {
  message: Message
  onOpen: (at: number) => void
  onFirstDownload?: (() => void) | undefined
  /** What this conversation fetches unasked. Undefined means nobody has been asked. */
  autoDownload?: AutoDownload | undefined
  /** What the reader asked for, where they have asked. Held by the screen, not by this row. */
  chosenView?: AttachmentView | undefined
  onChooseView?: ((view: AttachmentView) => void) | undefined
}) {
  const actions = useSessionActions()
  const set = useAttachmentSet(message)
  const view = attachmentView(message, chosenView)
  const [showingAll, setShowingAll] = useState(false)
  // A fact about the set rather than about what is open, so the sheet stays mounted while it
  // animates shut. Mounting one under every message in the transcript would be the alternative.
  const overflows = view === 'list' && message.attachments.length > LIST_MAX_ROWS

  function act(): void {
    if (set.state === 'ready') {
      // Exactly one, or the footer would not have offered this - see `verb`.
      const only = message.attachments[0]
      if (only !== undefined) void exportOne(message, only.index, actions)
      return
    }
    // Every attachment, whether or not a tile is drawing it. Download and retry are the same call:
    // one that is already cached is handed over at once.
    for (const attachment of message.attachments) {
      void actions.downloadAttachment(message.id, attachment.index)
    }
  }

  // Once rather than per shape: a message with nothing attached would otherwise draw an empty
  // album, because "every attachment can be shown" is true of no attachments at all.
  if (message.attachments.length === 0) return null

  return (
    <YStack gap="$3xs">
      {view === 'gallery' ? (
        <MessageAlbum
          message={message}
          onOpen={onOpen}
          control={<AttachmentPill set={set} />}
          autoDownload={autoDownload}
        />
      ) : (
        <AttachmentList
          message={message}
          onOpen={onOpen}
          onFirstDownload={onFirstDownload}
          autoDownload={autoDownload}
          {...(overflows
            ? {
                onShowAll: () => {
                  setShowingAll(true)
                },
              }
            : {})}
        />
      )}
      <AttachmentFooter
        set={set}
        onAction={act}
        {...(onChooseView === undefined || !canChooseView(message)
          ? {}
          : { view, onView: onChooseView })}
      />

      {/* The same rows and the same footer, on a surface that can be as tall as it needs to be.
          No toggle in here: the sheet is the list, and a control offering to make it a gallery
          would be offering to empty the thing the reader just opened. */}
      {!overflows ? null : (
        <Sheet
          open={showingAll}
          onClose={() => {
            setShowingAll(false)
          }}
          title={tr('attachments')}
          closeLabel={tr('close')}
          footer={<AttachmentFooter set={set} onAction={act} />}
          testID={ELEMENT.conversation.attachmentSheet}
          closeTestID={ELEMENT.conversation.attachmentSheetClose}
        >
          <AttachmentList message={message} onOpen={onOpen} onFirstDownload={onFirstDownload} />
        </Sheet>
      )}
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
  return summarise(
    message,
    (attachment: Attachment) => transfers[transferKey('download', message.id, attachment.index)],
  )
}
