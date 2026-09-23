import type { Attachment, AutoDownload } from '@session/client'

/**
 * Whether an attachment may be fetched without anybody asking for it.
 *
 * **Resolving a media url is a download.** The url *is* the request - asking for one is what
 * starts the transfer - so a tile handed one has already spent somebody's data by the time it
 * draws. Which makes this the one place the conversation's setting can be honoured at all.
 *
 * `image-attachments` is images and not video, which is libsession's own reading of it: the name
 * is `image_attachments` rather than "images" because a display picture is an image too and is
 * never governed by this.
 *
 * **Unset means no.** Nobody has been asked yet, and asking after the bytes have arrived is not
 * asking. It is the same answer as `none` here and a different one everywhere else - only `none`
 * records that the question was put.
 *
 * The same rule decides what a conversation fetches when a message *arrives*, which libsession
 * and the fake both apply for themselves. This one is about what drawing is allowed to start,
 * which is the half that lives up here because it is the url that does it.
 */
export function mayFetchUnasked(attachment: Attachment, setting?: AutoDownload): boolean {
  if (setting === 'all') return true
  if (setting === 'image-attachments') return attachment.contentType?.startsWith('image/') === true
  return false
}

/**
 * Whether a tile should be given a url at all.
 *
 * Cached is not a permission question: the bytes are on this device, reading them costs nothing
 * and refusing to draw them would be answering a question nobody asked. It became askable with
 * `availability` - before that the only thing that knew was a transfer this session happened to
 * watch, which a freshly loaded page does not have.
 */
export function mayResolve(attachment: Attachment, setting?: AutoDownload): boolean {
  return attachment.availability === 'cached' || mayFetchUnasked(attachment, setting)
}
