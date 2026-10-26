import type { ConversationId } from '@session/client'
import { tr } from '@session/localization'
import { transferKey, useMessage, useMessageTransfers, useSessionActions } from '@session/state'
import { ELEMENT } from '@session/test-ids'
import { MediaViewer, type MediaViewerItem } from '@session/ui'
import { useMemo, useRef } from 'react'

import { fetchOf } from './attachmentFetch'
import { exportOne } from './exportAttachment'
import { useExportFeedback } from './useExportFeedback'
import { PENDING_COPY } from './pendingCopy'
import { viewableAttachments, viewerUri } from './viewableAttachments'

/** An open viewer: which message, and the attachment's index in that message. */
export interface ViewerTarget {
  messageId: number
  index: number
}

function MessageViewer({
  conversationId,
  target,
  open,
  onIndex,
  onClose,
}: {
  conversationId: ConversationId
  target: ViewerTarget
  open: boolean
  onIndex: (index: number) => void
  onClose: () => void
}) {
  const actions = useSessionActions()
  const feedback = useExportFeedback()
  const message = useMessage(conversationId, target.messageId)
  const transfers = useMessageTransfers(target.messageId)
  // Only what is here, as the legacy clients' galleries: the file is served from the cache only,
  // so an item that is not here could not be drawn, and paging stops at what has arrived.
  const viewable = useMemo(
    () =>
      message === undefined
        ? []
        : viewableAttachments(message).filter(
            (a) => fetchOf(a, transfers[transferKey('download', a.index)]).state === 'ready',
          ),
    [message, transfers],
  )
  const items = useMemo(
    (): MediaViewerItem[] =>
      viewable.map((attachment) => ({
        // Null where the platform has no resolver. The viewer says so rather than drawing a broken
        // picture, which is the one thing it must not do with somebody's photograph.
        uri: viewerUri(target.messageId, attachment),
      })),
    [viewable, target.messageId],
  )

  if (message === undefined) return null
  const at = Math.max(
    0,
    viewable.findIndex((a) => a.index === target.index),
  )
  const attachment = viewable[at]

  return (
    <MediaViewer
      open={open}
      items={items}
      index={at}
      onIndex={(position) => {
        const next = viewable[position]
        if (next !== undefined) onIndex(next.index)
      }}
      onClose={onClose}
      onExport={() => {
        if (attachment !== undefined) void exportOne(message, attachment.index, actions, feedback)
      }}
      positionLabel={`${String(at + 1)} / ${String(items.length)}`}
      unavailableLabel={tr('attachmentsErrorNotSupported')}
      failedLabel={tr('attachmentsErrorOpen')}
      closeLabel={tr('close')}
      exportLabel={PENDING_COPY.export}
      previousLabel={PENDING_COPY.previous}
      nextLabel={tr('next')}
      testID={ELEMENT.conversation.mediaViewer}
      closeTestID={ELEMENT.conversation.mediaViewerClose}
      exportTestID={ELEMENT.conversation.mediaViewerExport}
      previousTestID={ELEMENT.conversation.mediaViewerPrevious}
      nextTestID={ELEMENT.conversation.mediaViewerNext}
      imageTestID={ELEMENT.conversation.mediaViewerImage}
    />
  )
}

/**
 * The conversation's one viewer, open on one message's attachments at a time.
 *
 * `MediaViewer` knows nothing about messages or ports: it takes resolved urls and worded labels,
 * because `@session/ui` reaches neither the catalogue nor `requirePorts`. Everything that has to
 * ask something is here.
 */
export function MessageMediaViewer({
  conversationId,
  target,
  onIndex,
  onClose,
}: {
  conversationId: ConversationId
  /** Null when nothing is open, so the caller holds one piece of state rather than two. */
  target: ViewerTarget | null
  onIndex: (index: number) => void
  onClose: () => void
}) {
  // Held past closing, so the fade-out plays over the picture that was open rather than the first.
  const last = useRef<ViewerTarget | null>(null)
  if (target !== null) last.current = target
  const shown = target ?? last.current
  if (shown === null) return null
  return (
    <MessageViewer
      conversationId={conversationId}
      target={shown}
      open={target !== null}
      onIndex={onIndex}
      onClose={onClose}
    />
  )
}
