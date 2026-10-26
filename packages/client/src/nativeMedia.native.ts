import { createSessionBridge, type SessionBridge } from '@session/bridge-rn'

import type { MediaSource } from './types'

/** Held so the HybridObject lives as long as it serves: collecting it closes it. */
let serving: SessionBridge | null = null

/** A view's own bytes as an ArrayBuffer, copied only when the view does not span its buffer. */
function wholeBuffer(bytes: Uint8Array): ArrayBuffer {
  const { buffer, byteOffset, byteLength } = bytes
  if (buffer instanceof ArrayBuffer && byteOffset === 0 && byteLength === buffer.byteLength) {
    return buffer
  }
  return bytes.slice().buffer as ArrayBuffer
}

/**
 * Answers the native image loaders from `source` rather than from libsession: the fake's bytes,
 * drawn through the real URL, loader, check and caches.
 *
 * Only while no bridge is open, which the native side enforces. Bytes cross from JavaScript here,
 * which is fine for the fake, whose bytes start in JavaScript anyway.
 */
export function serveNativeMediaFrom(source: MediaSource): void {
  serving?.close()
  const bridge = createSessionBridge()
  // Probed by `fetchThumbnail` rather than `serveMediaFrom`: a dev client with only the latter
  // takes the thumbnail function, ignores it, and fails every thumbnail URL without saying why.
  if (typeof (bridge as Partial<SessionBridge>).fetchThumbnail !== 'function') {
    throw new Error(
      'This dev client is older than the JavaScript it is running: its native side cannot serve ' +
        'media. Rebuild and reinstall it with `pnpm android` (or `pnpm ios`).',
    )
  }
  bridge.serveMediaFrom(
    async (messageId, index) => {
      const media = await source.fetchMedia({ messageId, index })
      return { contentType: media.contentType, bytes: wholeBuffer(media.bytes) }
    },
    async (messageId, index) => {
      const thumbhash = await source.fetchThumbhash({ messageId, index })
      return { width: thumbhash.width, height: thumbhash.height, rgba: wholeBuffer(thumbhash.rgba) }
    },
    async (messageId, index) => wholeBuffer(await source.fetchThumbnail({ messageId, index })),
  )
  serving = bridge
}
