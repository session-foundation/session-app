import { requirePorts } from '@session/app'
import type { Attachment, Message } from '@session/client'
import { tr } from '@session/localization'
import { useAttachmentTransfer, useSessionActions } from '@session/state'
import { ELEMENT } from '@session/test-ids'
import { FileRow, type FileRowState, Image, YStack } from '@session/ui'
import { useState } from 'react'

import { formatBytes } from './formatBytes'
import { saveOne } from './saveAttachment'

/**
 * One attachment on one message.
 *
 * Nothing here knows whether the bytes are on this device, because nothing records it: asking
 * for them is the answer, and an attachment already in the cache is handed over at once with no
 * progress reported at all. So the row starts at "download" even for a file that is here, and
 * the tap that follows is instant.
 */
export function AttachmentRow({
  message,
  attachment,
  onFirstDownload,
  onOpen,
}: {
  message: Message
  attachment: Attachment
  /** The conversation has never been asked what to fetch unprompted. Asked once, on first tap. */
  onFirstDownload?: () => void
  /** Opens the viewer at this attachment. Absent where nothing is showing one. */
  onOpen?: () => void
}) {
  const fetched = useAttachmentTransfer('download', message.id, attachment.index)

  // `unavailable` says the file server will not hand this out again, which does not unsay a copy
  // already in the cache - drawing "expired" over bytes we hold would refuse to show a file for
  // the one reason that does not apply to it.
  const expired = attachment.unavailable && fetched?.state !== 'done'

  // libsession's rule for what can be shown as a picture, not one re-derived from content types
  // here - it owns the definition and a gallery elsewhere would answer differently.
  const uri =
    message.galleryViewable && !expired
      ? requirePorts().media.urlFor(message.id, attachment.index)
      : null
  if (uri !== null) {
    return (
      <MediaAttachment
        attachment={attachment}
        uri={uri}
        {...(onOpen === undefined ? {} : { onOpen })}
      />
    )
  }
  return (
    <FileAttachment
      message={message}
      attachment={attachment}
      expired={expired}
      onFirstDownload={onFirstDownload}
    />
  )
}

/**
 * A picture, fetched by the platform as it draws.
 *
 * No download affordance and no auto-download prompt: the element asking for its own bytes is
 * what starts the transfer, and the same call reads the cache, joins one already running, or
 * starts one. The box is sized from the dimensions the sender supplied so the transcript does
 * not jump when the bytes land.
 */
function MediaAttachment({
  attachment,
  uri,
  onOpen,
}: {
  attachment: Attachment
  uri: string
  onOpen?: (() => void) | undefined
}) {
  const width = Math.min(attachment.width ?? DEFAULT_MEDIA_SIZE, DEFAULT_MEDIA_SIZE)
  const ratio = attachment.width && attachment.height ? attachment.height / attachment.width : 1

  const drawn = (
    <Image
      uri={uri}
      width={width}
      height={Math.round(width * ratio)}
      borderRadius={MEDIA_RADIUS}
      testID={ELEMENT.conversation.attachmentImage}
    />
  )

  // Wrapped rather than given an `onPress` of its own: `Image` is react-native's, and a press on
  // it would be a second way of doing what every other tappable thing here does with a stack.
  return onOpen === undefined ? (
    drawn
  ) : (
    <YStack accessibilityRole="button" onPress={onOpen}>
      {drawn}
    </YStack>
  )
}

/** As wide as a bubble is allowed to be, so a picture never sets the bubble's width. */
const DEFAULT_MEDIA_SIZE = 240
const MEDIA_RADIUS = 10

/**
 * A file, as a row.
 *
 * Everything drawn is `FileRow`'s; everything said is this side of the boundary, because the
 * wording is the catalogue's and the transfers are the store's, and `@session/ui` can reach
 * neither. What is left here is the mapping between them.
 *
 * Expired attachments come through here too, whatever their type: there is nothing to draw as a
 * picture, and the row is the shape that can carry a reason.
 */
function FileAttachment({
  message,
  attachment,
  expired,
  onFirstDownload,
}: {
  message: Message
  attachment: Attachment
  expired: boolean
  onFirstDownload?: (() => void) | undefined
}) {
  const actions = useSessionActions()
  const download = useAttachmentTransfer('download', message.id, attachment.index)
  const save = useAttachmentTransfer('save', message.id, attachment.index)
  const [error, setError] = useState(false)

  const state: FileRowState = expired
    ? 'unavailable'
    : download?.state === 'running'
      ? 'fetching'
      : download?.state === 'failed' || error
        ? 'failed'
        : download?.state === 'done'
          ? 'ready'
          : 'idle'

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
