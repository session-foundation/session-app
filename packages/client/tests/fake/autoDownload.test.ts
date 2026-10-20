import type { Attachment, AutoDownload } from '@session/bridge-types'
import { describe, expect, it } from 'vitest'

import { friends } from '#src/fake/index'

const attachment = (contentType: string): Attachment => ({
  index: 0,
  contentType,
  filename: 'file',
  sizeBytes: 1_000,
  voiceMessage: false,
  hasPreview: false,
  uploaded: true,
  availability: 'absent',
  fetchDoneBytes: 0,
  fetchTotalBytes: 0,
})

/** Whether an arriving file of this type is fetched unasked under `mode`. */
function fetchedUnasked(mode: AutoDownload, contentType: string): boolean {
  const { world } = friends(['Alice', 'Bob'], { history: 0 })
  const [alice, bob] = [world.account('Alice'), world.account('Bob')]
  alice.setAutoDownload(bob.sessionId, mode)
  const message = alice.deliverFrom(bob, '', world.now(), [attachment(contentType)])
  world.settle()
  return alice.isCached({ messageId: message.id, index: 0 })
}

describe("the fake's auto-download", () => {
  it('fetches an image under image-attachments, and anything under all', () => {
    expect(fetchedUnasked('image-attachments', 'image/jpeg')).toBe(true)
    expect(fetchedUnasked('image-attachments', 'video/mp4')).toBe(false)
    expect(fetchedUnasked('all', 'video/mp4')).toBe(true)
  })

  it("leaves a mixed-case image type alone, as libsession's case-sensitive prefix does", () => {
    expect(fetchedUnasked('image-attachments', 'Image/JPEG')).toBe(false)
  })
})
