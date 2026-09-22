import type { Attachment, Message } from '@session/client'
import { describe, expect, it } from 'vitest'

import { attachmentView, canChooseView } from '#src/attachmentView'

function attachment(index: number, contentType?: string): Attachment {
  return {
    index,
    ...(contentType === undefined ? {} : { contentType }),
    voiceMessage: false,
    uploaded: true,
    unavailable: false,
  }
}

function message(attachments: Attachment[], galleryViewable = true): Message {
  return { attachments, galleryViewable } as unknown as Message
}

describe('which shape a message takes', () => {
  it('draws pictures as a gallery', () => {
    expect(attachmentView(message([attachment(0, 'image/jpeg')]))).toBe('gallery')
  })

  it('draws pictures beside video as a gallery', () => {
    // A video has a frame to show, so a set of both is still a set of tiles.
    const set = message([attachment(0, 'image/jpeg'), attachment(1, 'video/mp4')])
    expect(attachmentView(set)).toBe('gallery')
  })

  it('sends the whole set to the list when one attachment is a plain file', () => {
    // Pictures included. A gallery with the documents hanging off the bottom draws one message as
    // two objects and leaves the reader to work out that they are one.
    const set = message([
      attachment(0, 'image/jpeg'),
      attachment(1, 'image/png'),
      attachment(2, 'application/pdf'),
    ])
    expect(attachmentView(set)).toBe('list')
  })

  it('sends a set the sender typed nothing for to the list', () => {
    // An absent content type claims nothing, and a tile drawn from nothing is a broken picture.
    expect(attachmentView(message([attachment(0)]))).toBe('list')
  })

  it('does not ask libsession, which answers a different question', () => {
    // `gallery_viewable` means every attachment is an `image/`, so it would send a set of
    // photographs and one video to the list - a set the album draws perfectly well.
    const set = message([attachment(0, 'image/jpeg'), attachment(1, 'video/mp4')], false)
    expect(attachmentView(set)).toBe('gallery')
  })
})

describe('when the reader gets to choose', () => {
  const photos = message([attachment(0, 'image/jpeg'), attachment(1, 'image/png')])
  const mixed = message([attachment(0, 'image/jpeg'), attachment(1, 'application/pdf')])

  it('offers the choice on a set a gallery could hold', () => {
    expect(canChooseView(photos)).toBe(true)
  })

  it('offers none where a plain file has settled it', () => {
    // A plain file makes the gallery impossible, not unwanted - so there is nothing to choose
    // between, and a toggle with one working half is worse than no toggle.
    expect(canChooseView(mixed)).toBe(false)
  })

  it('draws what was asked for', () => {
    expect(attachmentView(photos, 'list')).toBe('list')
    expect(attachmentView(photos, 'gallery')).toBe('gallery')
  })

  it('keeps the gallery where nothing was asked for', () => {
    expect(attachmentView(photos)).toBe('gallery')
  })

  it('ignores a choice on a set that has none', () => {
    // The choice is held per message and outlives what is on screen, so a set that has since
    // stopped being drawable as a gallery must not be handed one it cannot draw.
    expect(attachmentView(mixed, 'gallery')).toBe('list')
  })
})
