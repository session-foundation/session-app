import { MEDIA_URL_VECTORS } from '@session/client-contract'
import { describe, expect, it } from 'vitest'

import { mediaUrl, parseMediaUrl } from '#src/mediaUrl'

/**
 * A loader names a message and a position and gets bytes back, so this parser is the whole of
 * what a URL may ask for. The shim's parser answers the same vectors in bridge-node's tests.
 */
describe('a media url', () => {
  it('parses back exactly what the app builds', () => {
    for (const kind of ['attachment', 'preview'] as const) {
      for (const ref of [
        { messageId: 1, index: 0 },
        { messageId: 42, index: 7 },
        { messageId: Number.MAX_SAFE_INTEGER, index: Number.MAX_SAFE_INTEGER },
      ]) {
        expect(parseMediaUrl(mediaUrl(kind, ref))).toEqual({ kind, ref })
      }
    }
  })

  it('accepts and refuses what every parser of the scheme does', () => {
    for (const { url, parsed } of MEDIA_URL_VECTORS) {
      const expected =
        parsed === null
          ? null
          : { kind: parsed.kind, ref: { messageId: parsed.messageId, index: parsed.index } }
      expect(parseMediaUrl(url), url).toEqual(expected)
    }
  })
})
