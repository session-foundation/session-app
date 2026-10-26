import type { Message } from '@session/client'

import { isViewable } from './viewableAttachments'

export type AttachmentView = 'gallery' | 'list'

/**
 * Whether the reader gets to choose the shape.
 *
 * A plain file makes the gallery impossible, not unwanted. libsession says which messages can be
 * a gallery, and its whitelist takes AVIF and `image/pjpeg`, which the viewer here cannot open, so
 * each one must also be viewable. The list can hold any set, which is why this asks about the
 * gallery.
 */
export function canChooseView(message: Message): boolean {
  // TODO: draw a video as a tile once libsession has a still for it and galleryViewable admits it.
  return message.galleryViewable && message.attachments.every(isViewable)
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
 * `chosen` is the reader's answer where they have given one. The default is the gallery wherever
 * one is possible, so the only choice that changes anything is the list; a choice on a set that
 * cannot be a gallery is ignored.
 *
 * TODO: surface libsession's per-message gallery decision through the bridge and store the
 * reader's choice there; it is screen state today, so it is lost when the conversation closes.
 */
export function attachmentView(message: Message, chosen?: AttachmentView): AttachmentView {
  if (!canChooseView(message)) return 'list'
  return chosen ?? 'gallery'
}
