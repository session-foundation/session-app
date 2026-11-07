import { formatBytes } from '@session/basic-types'
import { requirePorts } from '@session/app'
import type { Attachment, Message } from '@session/client'
import { PENDING_COPY, tr } from '@session/localization'
import {
  useAttachmentTransfer,
  useSessionActions,
  type AttachmentTransferState,
} from '@session/state'
import { ELEMENT } from '@session/test-ids'
import { FileRow, type FileRowState, type FileRowThumbnail } from '@session/ui'

import { fetchOf, type Fetch } from './attachmentFetch'
import { controlVerb, rowVerb, verbLabel, type AttachmentVerb } from './attachmentPress'
import { useConversationUi } from './conversationUi'
import { exportOne } from './exportAttachment'
import { SendingRow } from './SendingRow'
import { isUploadPhase } from './uploadState'
import { useExportFeedback } from './useExportFeedback'
import { leadUri, leadsWithPicture, viewerFit } from './viewableAttachments'

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
 * One attachment on one message, as a row.
 *
 * Everything drawn is `FileRow`'s; everything said is this side of the boundary, because the
 * wording is the catalogue's and the transfers are the store's, and `@session/ui` can reach
 * neither. What is left here is the mapping between them.
 */
interface RowProps {
  message: Message
  attachment: Attachment
  /** Drawn on a bubble you sent; absent in the sheet, which draws its rows on the page. */
  onAccent?: boolean | undefined
  /** Drawn on a bubble someone else sent. */
  received?: boolean | undefined
}

/** One attachment as a row: its upload while ours is being sent, its download otherwise. */
export function AttachmentRow(props: RowProps) {
  return isUploadPhase(props.message) ? <SendingRow {...props} /> : <SettledRow {...props} />
}

function SettledRow({ message, attachment, onAccent, received }: RowProps) {
  const actions = useSessionActions()
  const feedback = useExportFeedback()
  const ui = useConversationUi()
  // The report is the live half; `attachment.availability` is the resting one. See `fetchOf`.
  const ref = { messageId: message.id, index: attachment.index }
  const report = useAttachmentTransfer('download', ref)
  const exporting = useAttachmentTransfer('export', ref)

  const fetched = fetchOf(attachment, report)
  const state: FileRowState = fetched.state

  const fit = viewerFit(attachment)
  const opens = fit !== 'exports'
  // Absent once expired: there is nothing to show and nothing a tap could fetch.
  const thumbnail: FileRowThumbnail | undefined =
    state === 'unavailable' || !leadsWithPicture(attachment)
      ? undefined
      : {
          uri: leadUri(message.id, attachment, state),
          fetchesOnOpen: state === 'idle' || state === 'failed',
          // Its own URL rather than pixels on the frame stream, so a placeholder reaches the
          // screen by the route a picture does. Null where the platform has no resolver.
          thumbhash: attachment.hasThumbhash
            ? requirePorts().media.thumbhashUrlFor(ref)
            : undefined,
        }

  function start(): void {
    ui.requestAutoDownloadPrompt()
    // A refusal is recorded as a failed transfer by the store, which `fetchOf` reads.
    void actions.downloadAttachment(ref).catch(() => undefined)
  }

  const perform: Record<AttachmentVerb, () => void> = {
    download: start,
    retry: start,
    export: () => void exportOne(message, attachment.index, actions, feedback),
    open: () => {
      ui.openViewer(message.id, attachment.index)
    },
  }
  const control = controlVerb(state)
  const press = rowVerb(state, fit)
  const pressLabel = press === null ? undefined : verbLabel(press)

  return (
    <FileRow
      filename={attachment.filename ?? tr('attachment')}
      contentType={attachment.contentType}
      thumbnail={thumbnail}
      // Held while fetching, when it does nothing, so the tile is not remounted as the state moves.
      onOpen={
        thumbnail === undefined || !opens
          ? undefined
          : () => {
              if (press !== null) perform[press]()
            }
      }
      // The lead square does what the row does and says so: the row is no stop on the web.
      openLabel={pressLabel}
      caption={caption(attachment, state, fetched, exporting?.state)}
      state={state}
      // Absent while the server has not said how big the file is, which is what the first report
      // of every transfer means: an empty ring rather than a full one.
      progress={fetched.totalBytes > 0 ? fetched.doneBytes / fetched.totalBytes : undefined}
      onPress={press === null ? undefined : perform[press]}
      pressLabel={pressLabel}
      actionLabel={
        state === 'fetching' ? tr('downloading') : control === null ? undefined : verbLabel(control)
      }
      onAction={control === null ? undefined : perform[control]}
      onAccent={onAccent}
      received={received}
      testIDs={{
        row: ELEMENT.conversation.attachment,
        name: ELEMENT.conversation.attachmentName,
        caption: ELEMENT.conversation.attachmentState,
        lead: ELEMENT.conversation.attachmentLead,
        thumbnail: ELEMENT.conversation.attachmentImage,
        // The id names what the control currently means rather than where it sits, which is the
        // only thing a test can ask about now that the two verbs share one button.
        action:
          control === 'export'
            ? ELEMENT.conversation.attachmentExport
            : ELEMENT.conversation.attachmentDownload,
      }}
    />
  )
}
