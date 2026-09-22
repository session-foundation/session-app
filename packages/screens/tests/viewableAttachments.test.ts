import type { Attachment, Message } from '@session/client'
import { describe, expect, it } from 'vitest'

import { isViewable, viewableAttachments, viewerIndices } from '#src/viewableAttachments'

function attachment(index: number, contentType?: string): Attachment {
  return {
    index,
    ...(contentType === undefined ? {} : { contentType }),
    voiceMessage: false,
    uploaded: true,
    unavailable: false,
  }
}

function message(attachments: Attachment[]): Message {
  return { attachments } as unknown as Message
}

describe('which attachments a viewer can show', () => {
  it('takes pictures and video', () => {
    expect(isViewable(attachment(0, 'image/jpeg'))).toBe(true)
    expect(isViewable(attachment(0, 'image/png'))).toBe(true)
    expect(isViewable(attachment(0, 'video/mp4'))).toBe(true)
  })

  it('leaves everything else alone', () => {
    expect(isViewable(attachment(0, 'application/pdf'))).toBe(false)
    expect(isViewable(attachment(0, 'audio/mpeg'))).toBe(false)
    // The sender's claim is all there is, and an absent one claims nothing.
    expect(isViewable(attachment(0))).toBe(false)
  })

  it('takes video, which gallery_viewable would not', () => {
    // libsession's `gallery_viewable` means *every* attachment is an `image/`, which is the right
    // rule for a gallery screen and the wrong one here: a video has a frame to show.
    const set = message([attachment(0, 'image/jpeg'), attachment(1, 'video/mp4')])
    expect(viewableAttachments(set)).toHaveLength(2)
  })

  it('leaves a position in the viewer different from a position in the message', () => {
    // The case that saves the wrong file if the two are confused: a document between two pictures
    // means the second picture is index 2 on the message and 1 in the viewer.
    const set = message([
      attachment(0, 'image/jpeg'),
      attachment(1, 'application/pdf'),
      attachment(2, 'image/png'),
    ])
    const viewable = viewableAttachments(set)
    expect(viewable.map((a) => a.index)).toEqual([0, 2])
    expect(viewable[1]?.index).toBe(2)
  })
})

describe('where an attachment sits in the viewer', () => {
  it('numbers the viewable ones from zero, skipping what the viewer cannot show', () => {
    // The row for the picture at message index 2 has to open the viewer at 1, not at 2. Off by
    // one here opens somebody else's photograph, and by more for every row after the document.
    const set = message([
      attachment(0, 'image/jpeg'),
      attachment(1, 'application/pdf'),
      attachment(2, 'image/png'),
      attachment(3, 'video/mp4'),
    ])
    expect([...viewerIndices(set)]).toEqual([
      [0, 0],
      [2, 1],
      [3, 2],
    ])
  })

  it('has nothing for an attachment the viewer cannot show', () => {
    const set = message([attachment(0, 'application/pdf')])
    expect(viewerIndices(set).get(0)).toBeUndefined()
  })
})
