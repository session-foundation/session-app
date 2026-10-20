import { isImageContentType, isViewableVideo } from '@session/basic-types'
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
function mayFetchUnasked(attachment: Attachment, setting?: AutoDownload): boolean {
  if (setting === 'all') return true
  // The prefix, not the viewable whitelist: this mirrors what libsession itself fetches unasked.
  if (setting === 'image-attachments') return isImageContentType(attachment.contentType)
  return false
}

/**
 * Whether a tile should be given a url at all.
 *
 * Cached is not a permission question: the bytes are on this device, reading them costs nothing
 * and refusing to draw them would be answering a question nobody asked.
 *
 * **Expired is a hard no, asked or not.** A url is a request, and asking for a file the file
 * server has already given up on would only fail - the setting has nothing to do with it.
 */
export function mayResolve(attachment: Attachment, setting?: AutoDownload): boolean {
  if (attachment.availability === 'notFound' || attachment.availability === 'unreadable')
    return false
  return attachment.availability === 'cached' || mayFetchUnasked(attachment, setting)
}

/**
 * Whether a tile may be handed a url: `mayResolve`, less video.
 *
 * Nothing here plays one yet, so a video's url would only have each loader decrypt the file and
 * copy it into an image decoder that fails on it, on every mount. Its still comes from the
 * sender's preview, which this does not govern.
 */
export function mayDrawInline(attachment: Attachment, setting?: AutoDownload): boolean {
  return !isViewableVideo(attachment.contentType) && mayResolve(attachment, setting)
}
