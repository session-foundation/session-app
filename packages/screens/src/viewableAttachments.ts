import type { Attachment, Message } from '@session/client'

/**
 * The attachments on a message that a viewer can show.
 *
 * Derived from `contentType` rather than taken from `Message.galleryViewable`, which is the one
 * place this departs from libsession's own answer. `gallery_viewable` means *every* attachment is
 * an `image/`, which is the right rule for a gallery screen and the wrong one here twice over: a
 * video has a frame to show, and a message mixing a picture with a document still has a picture
 * somebody can open.
 *
 * Order is the message's own, so an index here is a position in the viewer and
 * `attachment.index` is the position in the message. Those are not the same number as soon as a
 * document sits between two pictures, and confusing them saves the wrong file.
 */
export function viewableAttachments(message: Message): Attachment[] {
  return message.attachments.filter(isViewable)
}

export function isViewable(attachment: Attachment): boolean {
  const type = attachment.contentType
  if (type === undefined) return false
  return type.startsWith('image/') || type.startsWith('video/')
}
