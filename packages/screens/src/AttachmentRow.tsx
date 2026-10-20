import { formatBytes, mediaKindOf } from '@session/basic-types'
import { requirePorts } from '@session/app'
import type { Attachment, Message } from '@session/client'
import { tr } from '@session/localization'
import {
  useAttachmentTransfer,
  useSessionActions,
  type AttachmentTransferState,
} from '@session/state'
import { ELEMENT } from '@session/test-ids'
import { FileRow, type FileRowState, type FileRowThumbnail } from '@session/ui'

import { fetchOf, type Fetch } from './attachmentFetch'
import { mayDrawInline } from './autoDownload'
import { useConversationUi } from './conversationUi'
import { PENDING_COPY } from './pendingCopy'
import { exportOne } from './exportAttachment'
import { useExportFeedback } from './useExportFeedback'
import { isViewable } from './viewableAttachments'

function caption(
  attachment: Attachment,
  state: FileRowState,
  fetched: Fetch,
  exporting: AttachmentTransferState['state'] | undefined,
): string {
  if (state === 'unavailable')
    return tr(
      attachment.availability === 'unreadable' ? 'attachmentsErrorOpen' : 'attachmentsExpired',
    )
  if (state === 'failed') return tr('failedToDownload')
  if (state === 'fetching') {
    // Indeterminate until the server says how big it is, which is what a total of 0 means.
    if (fetched.totalBytes === 0) return tr('downloading')
    return `${formatBytes(fetched.doneBytes)} / ${formatBytes(fetched.totalBytes)}`
  }
  if (exporting === 'running') return PENDING_COPY.exporting
  if (exporting === 'failed') return PENDING_COPY.exportFailed
  return attachment.sizeBytes === undefined ? '' : formatBytes(attachment.sizeBytes)
}

/**
 * What a screen reader announces the one control as. The glyph is what everyone else reads.
 *
 * Two verbs, and the state settles which with no further rule: Download moves bytes from the
 * network into the cache, Export writes a file we already hold out to a folder somebody chose.
 */
function actionLabel(state: FileRowState): string {
  if (state === 'failed') return tr('retry')
  return state === 'ready' ? PENDING_COPY.export : tr('download')
}

/**
 * One attachment on one message, as a row.
 *
 * Everything drawn is `FileRow`'s; everything said is this side of the boundary, because the
 * wording is the catalogue's and the transfers are the store's, and `@session/ui` can reach
 * neither. What is left here is the mapping between them.
 */
export function AttachmentRow({
  message,
  attachment,
}: {
  message: Message
  attachment: Attachment
}) {
  const actions = useSessionActions()
  const feedback = useExportFeedback()
  const ui = useConversationUi()
  // The report is the live half; `attachment.availability` is the resting one. See `fetchOf`.
  const ref = { messageId: message.id, index: attachment.index }
  const report = useAttachmentTransfer('download', ref)
  const exporting = useAttachmentTransfer('export', ref)

  const fetched = fetchOf(attachment, report)
  const state: FileRowState = fetched.state

  // A picture fetches itself as it draws: the url *is* the request, and the same call reads the
  // cache, joins a transfer already running, or starts one. Absent once expired, where asking
  // would only fail.
  const thumbnail: FileRowThumbnail | undefined =
    state === 'unavailable' || !isViewable(attachment)
      ? undefined
      : {
          // Left off where this is not ours to fetch: a url is the request, so handing one over
          // would spend the data the person was about to be asked about. Left off after a failure
          // too, so a retry hands it over afresh and the image tries again.
          uri:
            mayDrawInline(attachment, ui.autoDownload) && state !== 'failed'
              ? requirePorts().media.urlFor(ref)
              : undefined,
          kind: mediaKindOf(attachment.contentType),
          fetchesOnOpen: state === 'idle' || state === 'failed',
          // Its own URL rather than pixels on the frame stream, so a placeholder reaches the
          // screen by the route a picture does. Null where the platform has no resolver.
          preview: attachment.hasPreview ? requirePorts().media.previewUrlFor(ref) : undefined,
          failedLabel: tr('attachmentsErrorOpen'),
        }

  function start(): void {
    ui.requestAutoDownloadPrompt()
    // A refusal is recorded as a failed transfer by the store, which `fetchOf` reads.
    void actions.downloadAttachment(ref).catch(() => undefined)
  }

  const act =
    state === 'ready' ? () => void exportOne(message, attachment.index, actions, feedback) : start
  const offersAction = state !== 'unavailable' && state !== 'fetching'

  return (
    <FileRow
      filename={attachment.filename ?? tr('attachment')}
      contentType={attachment.contentType}
      thumbnail={thumbnail}
      // Opens only a picture that is here, as the legacy clients do; otherwise the tap fetches it.
      onOpen={
        thumbnail === undefined
          ? undefined
          : () => {
              if (state === 'ready') ui.openViewer(message.id, attachment.index)
              else if (state === 'idle' || state === 'failed') start()
            }
      }
      caption={caption(attachment, state, fetched, exporting?.state)}
      state={state}
      // Absent while the server has not said how big the file is, which is what the first report
      // of every transfer means: an empty ring rather than a full one.
      progress={fetched.totalBytes > 0 ? fetched.doneBytes / fetched.totalBytes : undefined}
      actionLabel={offersAction ? actionLabel(state) : undefined}
      onAction={offersAction ? act : undefined}
      testIDs={{
        row: ELEMENT.conversation.attachment,
        name: ELEMENT.conversation.attachmentName,
        caption: ELEMENT.conversation.attachmentState,
        thumbnail: ELEMENT.conversation.attachmentImage,
        thumbnailFailed: ELEMENT.conversation.attachmentFailed,
        // The id names what the control currently means rather than where it sits, which is the
        // only thing a test can ask about now that the two verbs share one button.
        action:
          state === 'ready'
            ? ELEMENT.conversation.attachmentExport
            : ELEMENT.conversation.attachmentDownload,
      }}
    />
  )
}
