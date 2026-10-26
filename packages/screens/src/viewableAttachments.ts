import { isDisplayableImage, isViewableImage } from '@session/basic-types'
import { requirePorts } from '@session/app'
import type { Attachment, Message } from '@session/client'

import type { FetchState } from './attachmentFetch'

/**
 * A whitelist rather than a prefix: `image/svg+xml`, `image/heic` and `image/tiff` are pictures no
 * renderer here draws reliably, and desktop refuses to serve anything outside the list. A video is
 * a file: libsession makes no thumbnail of one.
 */
export function isViewable(attachment: Attachment): boolean {
  return isViewableImage(attachment.contentType)
}

/**
 * Whether a file row leads with a picture rather than a glyph: anything libsession thumbnailed,
 * which includes types the viewer cannot open, and anything the viewer can.
 */
export function leadsWithPicture(attachment: Attachment): boolean {
  return attachment.hasThumbnail || isViewable(attachment)
}

/**
 * What a row square or an album tile draws: libsession's thumbnail, else the file once it is here
 * where it is viewable but of a type libsession never thumbnails (BMP), else nothing and the
 * placeholder stays. A type libsession does thumbnail waits for it rather than decode the file.
 */
export function leadUri(
  messageId: number,
  attachment: Attachment,
  state: FetchState,
): string | null | undefined {
  const ref = { messageId, index: attachment.index }
  if (attachment.hasThumbnail) return requirePorts().media.thumbnailUrlFor(ref)
  if (state === 'ready' && isViewable(attachment) && !isDisplayableImage(attachment.contentType))
    return requirePorts().media.urlFor(ref)
  return undefined
}

/**
 * The attachments on a message that a viewer can show.
 *
 * Wider than `Message.galleryViewable`: a message mixing a picture with a document is a list, and
 * its picture is still something somebody can open.
 *
 * Order is the message's own, so an index here is a position in the viewer and
 * `attachment.index` is the position in the message. Those are not the same number as soon as a
 * document sits between two pictures, and confusing them exports the wrong file.
 */
export function viewableAttachments(message: Message): Attachment[] {
  return message.attachments.filter(isViewable)
}

/**
 * What the viewer is handed to draw `attachment`, or null where the platform has no resolver: the
 * file itself, never the thumbnail a tile draws.
 */
export function viewerUri(messageId: number, attachment: Attachment): string | null {
  // TODO: a picture larger than the screen may need a rendition at screen size rather than the
  // whole file decoded and reduced; export must keep writing out the raw content either way.
  return requirePorts().media.urlFor({ messageId, index: attachment.index })
}
