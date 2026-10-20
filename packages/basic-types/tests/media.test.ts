import { describe, expect, it } from 'vitest'

import {
  isImageContentType,
  isViewableContentType,
  isViewableImage,
  isViewableVideo,
  mediaKindOf,
} from '#src/media'

describe('which content types are viewable', () => {
  it('draws the common bitmaps and refuses svg', () => {
    expect(isViewableImage('image/png')).toBe(true)
    expect(isViewableImage('image/svg+xml')).toBe(false)
    // Still an image, so it is not a file row's generic glyph, only not drawn inline.
    expect(isImageContentType('image/svg+xml')).toBe(true)
  })

  it('accepts the unregistered image/jpg that senders send', () => {
    expect(isViewableImage('image/jpg')).toBe(true)
  })

  it('ignores parameters and case', () => {
    expect(isViewableImage('Image/JPEG; charset=binary')).toBe(true)
    expect(isViewableVideo('VIDEO/MP4;codecs="avc1"')).toBe(true)
    expect(isImageContentType(' IMAGE/HEIC')).toBe(true)
    expect(isViewableImage('\t\r\n\f\v image/png \v\f\n\r\t')).toBe(true)
  })

  it('trims ASCII space only, as the shim does', () => {
    expect(isViewableImage('\u00a0image/png')).toBe(false)
    expect(isViewableImage('\ufeffimage/png')).toBe(false)
    expect(isViewableImage('image/png\u2003')).toBe(false)
  })

  it('refuses an absent or unknown type', () => {
    expect(isViewableContentType(undefined)).toBe(false)
    expect(isViewableContentType('application/octet-stream')).toBe(false)
    expect(isViewableContentType('video/quicktime')).toBe(false)
  })
})

describe('a viewable type’s kind', () => {
  it('is video only for a viewable video', () => {
    expect(mediaKindOf('video/webm')).toBe('video')
    expect(mediaKindOf('image/gif')).toBe('image')
  })
})
