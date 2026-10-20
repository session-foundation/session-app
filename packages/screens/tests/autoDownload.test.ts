import type { Attachment } from '@session/client'
import { describe, expect, it } from 'vitest'

import { mayDrawInline, mayResolve } from '#src/autoDownload'

function attachment(
  contentType: string,
  availability: Attachment['availability'] = 'absent',
): Attachment {
  return {
    index: 0,
    contentType,
    voiceMessage: false,
    hasPreview: false,
    uploaded: true,
    availability,
    fetchDoneBytes: 0,
    fetchTotalBytes: 0,
  }
}

describe('what drawing may fetch unasked', () => {
  it('follows libsession’s image rule, which is a prefix rather than the viewable list', () => {
    expect(mayResolve(attachment('image/svg+xml'), 'image-attachments')).toBe(true)
    expect(mayResolve(attachment('video/mp4'), 'image-attachments')).toBe(false)
  })

  it('fetches nothing for a conversation nobody has been asked about', () => {
    expect(mayResolve(attachment('image/jpeg'), undefined)).toBe(false)
    expect(mayResolve(attachment('image/jpeg'), 'none')).toBe(false)
  })

  it('draws what is already here whatever the setting', () => {
    expect(mayResolve(attachment('image/jpeg', 'cached'), 'none')).toBe(true)
  })

  it('refuses an expired attachment even when the setting would otherwise fetch it unasked', () => {
    // The album's tiles rely on this, not on the row, to refuse a file the server has given up on.
    expect(mayResolve(attachment('image/jpeg', 'notFound'), 'all')).toBe(false)
    expect(mayResolve(attachment('image/jpeg', 'unreadable'), 'all')).toBe(false)
  })
})

describe('what a tile may draw inline', () => {
  it('is what may resolve, for a picture', () => {
    expect(mayDrawInline(attachment('image/jpeg', 'cached'), 'none')).toBe(true)
    expect(mayDrawInline(attachment('image/jpeg'), 'all')).toBe(true)
    expect(mayDrawInline(attachment('image/jpeg'), 'none')).toBe(false)
  })

  it('is never a video, cached or not, until something here can play one', () => {
    // A url is a request the image loaders answer by decrypting the file and handing it to a
    // picture decoder, which fails on a video on every mount.
    expect(mayDrawInline(attachment('video/mp4', 'cached'), 'none')).toBe(false)
    expect(mayDrawInline(attachment('video/mp4'), 'all')).toBe(false)
  })
})
