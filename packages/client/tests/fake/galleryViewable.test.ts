import type { Attachment } from '@session/bridge-types'
import { describe, expect, it } from 'vitest'

import { friends } from '#src/fake/index'

const attachment = (index: number, contentType: string): Attachment => ({
  index,
  contentType,
  filename: `file-${String(index)}`,
  sizeBytes: 1_000,
  voiceMessage: false,
  hasThumbhash: false,
  hasThumbnail: false,
  uploaded: true,
  availability: 'absent',
  fetchDoneBytes: 0,
  fetchTotalBytes: 0,
})

function deliver(...contentTypes: string[]) {
  const { world } = friends(['Alice', 'Bob'], { history: 0 })
  const attachments = contentTypes.map((type, i) => attachment(i, type))
  return world.account('Alice').deliverFrom(world.account('Bob'), '', world.now(), attachments)
}

describe("the fake's galleryViewable", () => {
  it('admits a message whose attachments are all images', () => {
    expect(deliver('image/jpeg', 'image/png').galleryViewable).toBe(true)
  })

  it('refuses a message with no attachments, or with one that is not an image', () => {
    expect(deliver().galleryViewable).toBe(false)
    expect(deliver('image/jpeg', 'video/mp4').galleryViewable).toBe(false)
  })

  it("admits a mixed-case type, as libsession's case-insensitive whitelist does", () => {
    expect(deliver('Image/JPEG').galleryViewable).toBe(true)
  })

  it('refuses an image type outside the whitelist', () => {
    expect(deliver('image/jpeg', 'image/svg+xml').galleryViewable).toBe(false)
    expect(deliver('image/heic').galleryViewable).toBe(false)
  })
})
