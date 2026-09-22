import { requirePorts } from '@session/app'
import type { Attachment, AutoDownload, Message } from '@session/client'
import { tr } from '@session/localization'
import { useAttachmentTransfer, useSessionActions } from '@session/state'
import { ELEMENT } from '@session/test-ids'
import { FileRow, type FileRowState, type FileRowThumbnail } from '@session/ui'
import { useState } from 'react'

import { mayResolve } from './autoDownload'
import { formatBytes } from './formatBytes'
import { saveOne } from './saveAttachment'
import { isViewable } from './viewableAttachments'

/**
 * One attachment on one message, as a row.
 *
 * Everything drawn is `FileRow`'s; everything said is this side of the boundary, because the
 * wording is the catalogue's and the transfers are the store's, and `@session/ui` can reach
 * neither. What is left here is the mapping between them.
 *
 * Nothing here knows whether the bytes are on this device, because nothing records it: asking for
 * them is the answer, and an attachment already in the cache is handed over at once with no
 * progress reported at all. So the row starts at "download" even for a file that is here, and the
 * tap that follows is instant.
 */
export function AttachmentRow({
  message,
  attachment,
  onFirstDownload,
  onOpen,
  autoDownload,
}: {
  message: Message
  attachment: Attachment
  /** The conversation has never been asked what to fetch unprompted. Asked once, on first tap. */
  onFirstDownload?: (() => void) | undefined
  /** Opens the viewer at this attachment. Absent on a row with no picture behind it. */
  onOpen?: (() => void) | undefined
  /** What this conversation fetches unasked. Undefined means nobody has been asked. */
  autoDownload?: AutoDownload | undefined
}) {
  const actions = useSessionActions()
  const download = useAttachmentTransfer('download', message.id, attachment.index)
  const save = useAttachmentTransfer('save', message.id, attachment.index)
  const [error, setError] = useState(false)

  // `unavailable` says the file server will not hand this out again, which does not unsay a copy
  // already in the cache - drawing "expired" over bytes we hold would refuse to show a file for
  // the one reason that does not apply to it.
  const expired = attachment.unavailable && download?.state !== 'done'

  const state: FileRowState = expired
    ? 'unavailable'
    : download?.state === 'running'
      ? 'fetching'
      : download?.state === 'failed' || error
        ? 'failed'
        : download?.state === 'done'
          ? 'ready'
          : 'idle'

  // A picture fetches itself as it draws: the url *is* the request, and the same call reads the
  // cache, joins a transfer already running, or starts one. Absent once expired, where asking
  // would only fail.
  const thumbnail: FileRowThumbnail | undefined =
    expired || !isViewable(attachment)
      ? undefined
      : {
          // Left off where this is not ours to fetch: a url is the request, so handing one over
          // would spend the data the person was about to be asked about.
          ...(mayResolve(attachment, autoDownload)
            ? { uri: requirePorts().media.urlFor(message.id, attachment.index) }
            : {}),
          kind: attachment.contentType?.startsWith('video/') === true ? 'video' : 'image',
        }

  function start(): void {
    setError(false)
    onFirstDownload?.()
    void actions.downloadAttachment(message.id, attachment.index).catch(() => {
      setError(true)
    })
  }

  const act = state === 'ready' ? () => void saveOne(message, attachment.index, actions) : start

  return (
    <FileRow
      filename={attachment.filename ?? tr('attachment')}
      {...(attachment.contentType === undefined ? {} : { contentType: attachment.contentType })}
      {...(thumbnail === undefined ? {} : { thumbnail })}
      {...(thumbnail === undefined || onOpen === undefined ? {} : { onOpen })}
      caption={caption(attachment, state, download, save?.state === 'running')}
      state={state}
      // Absent while the server has not said how big the file is, which is what the first report
      // of every transfer means: an empty ring rather than a full one.
      {...(download && download.total > 0 ? { progress: download.done / download.total } : {})}
      {...(state === 'unavailable' || state === 'fetching'
        ? {}
        : { actionLabel: actionLabel(state), onAction: act })}
      testIDs={{
        row: ELEMENT.conversation.attachment,
        name: ELEMENT.conversation.attachmentName,
        caption: ELEMENT.conversation.attachmentState,
        thumbnail: ELEMENT.conversation.attachmentImage,
        // The id names what the control currently means rather than where it sits, which is the
        // only thing a test can ask about now that the two verbs share one button.
        action:
          state === 'ready'
            ? ELEMENT.conversation.attachmentSave
            : ELEMENT.conversation.attachmentDownload,
      }}
    />
  )
}

type Transfer = ReturnType<typeof useAttachmentTransfer>

function caption(
  attachment: Attachment,
  state: FileRowState,
  download: Transfer,
  saving: boolean,
): string {
  if (state === 'unavailable') return tr('attachmentsExpired')
  if (state === 'failed') return tr('failedToDownload')
  if (state === 'fetching') {
    // Indeterminate until the server says how big it is, which is what a total of 0 means.
    if (download === undefined || download.total === 0) return tr('downloading')
    return `${formatBytes(download.done)} / ${formatBytes(download.total)}`
  }
  if (saving) return tr('saving')
  return attachment.size === undefined ? '' : formatBytes(attachment.size)
}

/** What a screen reader announces the one control as. The glyph is what everyone else reads. */
function actionLabel(state: FileRowState): string {
  if (state === 'failed') return tr('retry')
  // `save` until the catalogue has a key for exporting; the two verbs are their own piece of work.
  return state === 'ready' ? tr('save') : tr('download')
}
