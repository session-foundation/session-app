import type { Message } from '@session/client'

import { isViewable } from './viewableAttachments'

export type AttachmentView = 'gallery' | 'list'

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
 */
export function attachmentView(message: Message): AttachmentView {
  return message.attachments.every(isViewable) ? 'gallery' : 'list'
}
