import type { Message } from '@session/client'

import { isViewable } from './viewableAttachments'

export type AttachmentView = 'gallery' | 'list'

/**
 * Whether the reader gets to choose the shape.
 *
 * A plain file makes the gallery impossible, not unwanted - so the choice exists exactly when
 * every attachment is one a tile can draw. The list can hold any set, which is why this asks
 * about the gallery.
 */
export function canChooseView(message: Message): boolean {
  return message.attachments.every(isViewable)
}

/**
 * Which shape a message's attachments take.
 *
 * **One plain file puts the whole set in a list**, pictures included. The alternative is a gallery
 * with the documents hanging off the bottom of it, which draws one message as two objects and
 * leaves the reader to work out that they are one.
 *
 * The list is also the only shape with room for a per-item state, a per-item control and a
 * per-item retry - and libsession has been reporting per `(message_id, index)` all along. A set
 * that cannot be drawn as a gallery is exactly the set most likely to need them.
 *
 * Not `Message.galleryViewable`: that means *every* attachment is an `image/`, so it sends a
 * message mixing photographs with a video to the list, which the album draws perfectly well.
 *
 * `chosen` is the reader's answer where they have given one. It can only ever pick the gallery
 * over the default, because the default *is* the gallery wherever the gallery is possible - so a
 * stale choice on a set that has none is ignored rather than obeyed.
 */
export function attachmentView(message: Message, chosen?: AttachmentView): AttachmentView {
  if (!canChooseView(message)) return 'list'
  return chosen ?? 'gallery'
}
