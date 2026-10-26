import { describe, expect, it } from 'vitest'

import {
  ALBUM_WIDTH,
  contentTypeEssence,
  isDisplayableImage,
  isViewableContentType,
  isViewableImage,
  isViewableVideo,
  mediaKindOf,
  thumbnailEdgePxFor,
} from '#src/media'

describe('the essence of a declared content type', () => {
  it('drops parameters, folds case and trims ASCII space', () => {
    expect(contentTypeEssence('Image/JPEG; charset=binary')).toBe('image/jpeg')
    expect(contentTypeEssence(' video/MP4 ;codecs="avc1"')).toBe('video/mp4')
    expect(contentTypeEssence('\t\r\n image/png \n\r\t')).toBe('image/png')
    expect(contentTypeEssence('image/png')).toBe('image/png')
  })

  it('keeps a NUL, which no type it is compared with carries', () => {
    expect(contentTypeEssence('image/png\0.exe')).toBe('image/png\0.exe')
    expect(isViewableImage('image/png\0')).toBe(false)
  })

  it('trims space, tab, CR and LF alone', () => {
    expect(contentTypeEssence('\fimage/png\v')).toBe('\fimage/png\v')
    expect(contentTypeEssence('\u00a0image/png')).toBe('\u00a0image/png')
  })

  it('folds ASCII case alone', () => {
    // A Unicode-aware lowercase turns the Kelvin sign into a k.
    expect(contentTypeEssence('image/\u212a')).toBe('image/\u212a')
  })

  it('has no essence for an absent type', () => {
    expect(contentTypeEssence(undefined)).toBeUndefined()
  })
})

describe('which content types are viewable', () => {
  it('draws the common bitmaps and refuses svg', () => {
    expect(isViewableImage('image/png')).toBe(true)
    expect(isViewableImage('image/svg+xml')).toBe(false)
  })

  it('accepts the unregistered image/jpg that senders send', () => {
    expect(isViewableImage('image/jpg')).toBe(true)
  })

  it('ignores parameters and case', () => {
    expect(isViewableImage('Image/JPEG; charset=binary')).toBe(true)
    expect(isViewableVideo('VIDEO/MP4;codecs="avc1"')).toBe(true)
    expect(isViewableImage('\t\r\n image/png \n\r\t')).toBe(true)
  })

  it('trims no Unicode space', () => {
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

describe('which content types libsession calls displayable', () => {
  it('is its whitelist, in any ASCII case', () => {
    expect(isDisplayableImage('IMAGE/Jpeg')).toBe(true)
    expect(isDisplayableImage('image/pjpeg')).toBe(true)
    expect(isDisplayableImage('image/avif')).toBe(true)
  })

  it('refuses a picture outside it, and a prefix match', () => {
    expect(isDisplayableImage('image/svg+xml')).toBe(false)
    expect(isDisplayableImage('image/heic')).toBe(false)
    expect(isDisplayableImage('image/bmp')).toBe(false)
    expect(isDisplayableImage('image/pngx')).toBe(false)
    expect(isDisplayableImage(undefined)).toBe(false)
  })

  it('compares the essence, as libsession does: parameters and edge space ignored', () => {
    expect(isDisplayableImage('image/jpeg; charset=binary')).toBe(true)
    expect(isDisplayableImage(' image/png')).toBe(true)
  })
})

describe('a viewable type’s kind', () => {
  it('is video only for a viewable video', () => {
    expect(mediaKindOf('video/webm')).toBe('video')
    expect(mediaKindOf('image/gif')).toBe('image')
  })
})

describe('the edge thumbnails are made at', () => {
  it('follows the densest display', () => {
    expect(thumbnailEdgePxFor([1, 2, 1.5])).toBe(ALBUM_WIDTH * 2)
  })

  it('makes them at 1x with no display connected', () => {
    expect(thumbnailEdgePxFor([])).toBe(ALBUM_WIDTH)
  })
})
