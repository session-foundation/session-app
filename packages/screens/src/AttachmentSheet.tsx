import type { Attachment, ConversationId, Message } from '@session/client'
import { tr } from '@session/localization'
import { useMessage } from '@session/state'
import { ELEMENT } from '@session/test-ids'
import { fileRowHeight, List, Sheet, useFontScale, YStack } from '@session/ui'
import { useCallback, useRef, type ReactNode } from 'react'

import { AttachmentFooter, ROW_OVERHANG } from './AttachmentFooter'
import { AttachmentRow } from './AttachmentRow'
import { useAttachmentSet } from './useAttachmentSet'

const attachmentKey = (attachment: Attachment): string => String(attachment.index)

function SheetFooter({ message }: { message: Message }) {
  const { set, act } = useAttachmentSet(message)
  // Inside the sheet's footer, so the overhang lies over this padding and not over the rows.
  return (
    <YStack paddingTop={ROW_OVERHANG}>
      <AttachmentFooter set={set} onAction={act} />
    </YStack>
  )
}

function MessageSheet({
  conversationId,
  messageId,
  open,
  onClose,
  overlay,
}: {
  conversationId: ConversationId
  messageId: number
  open: boolean
  onClose: () => void
  overlay: ReactNode
}) {
  const message = useMessage(conversationId, messageId)
  const shown = open && message !== undefined
  const rowHeight = fileRowHeight(useFontScale())
  const renderRow = useCallback(
    (attachment: Attachment) =>
      message === undefined ? null : <AttachmentRow message={message} attachment={attachment} />,
    [message],
  )
  return (
    <>
      {shown ? null : overlay}
      <Sheet
        open={shown}
        overlay={shown ? overlay : undefined}
        onClose={onClose}
        title={tr('attachments')}
        closeLabel={tr('close')}
        footer={message === undefined ? undefined : <SheetFooter message={message} />}
        testID={ELEMENT.conversation.attachmentSheet}
        closeTestID={ELEMENT.conversation.attachmentSheetClose}
        scrimTestID={ELEMENT.conversation.attachmentSheetScrim}
        bodyIsList
      >
        {message === undefined ? null : (
          // Windowed: a set this long mounted all at once is a pause between the tap and the sheet.
          // With the row height given, the sheet opens at its full height rather than growing as
          // the rows measure.
          <List
            data={message.attachments}
            keyExtractor={attachmentKey}
            renderItem={renderRow}
            itemHeight={rowHeight}
            fitsContent
            paddingHorizontal="md"
          />
        )}
      </Sheet>
    </>
  )
}

/**
 * Every attachment of one message, on a surface that can be as tall as it needs to be.
 *
 * The same rows and the same footer as the transcript. No toggle in here: the sheet is the list,
 * and a control offering to make it a gallery would be offering to empty what was just opened.
 */
export function AttachmentSheet({
  conversationId,
  messageId,
  onClose,
  overlay,
}: {
  conversationId: ConversationId
  /** Null when closed. */
  messageId: number | null
  onClose: () => void
  /**
   * Whatever the screen can open over the sheet: drawn inside it while it is open, and beside it
   * otherwise, since iOS will not present a modal beside one that is already up.
   */
  overlay: ReactNode
}) {
  // Held past closing, so the sheet animates shut with its rows still in it.
  const last = useRef<number | null>(null)
  if (messageId !== null) last.current = messageId
  const shown = messageId ?? last.current
  if (shown === null) return <>{overlay}</>
  return (
    <MessageSheet
      conversationId={conversationId}
      messageId={shown}
      open={messageId !== null}
      onClose={onClose}
      overlay={overlay}
    />
  )
}
