import { NitroModules } from 'react-native-nitro-modules'

import type { NativeFrame, SessionBridge as Spec } from './SessionBridge.nitro'

export type { NativeFrame, NativeRequest } from './SessionBridge.nitro'

/**
 * The spec plus `setSink`, which the C++ registers itself (see HybridSessionBridge::setSink).
 *
 * `setSink` before `init`: libsession publishes the state it already has while the Client is
 * being constructed, so a sink installed afterwards has already missed the first frames, and
 * `init` refuses to run without one.
 */
export type SessionBridge = Spec & {
  setSink(onFrame: (frame: NativeFrame) => void): void
  /**
   * Answers the image loaders from JavaScript rather than from libsession, until `close()`: what
   * lets the fake, which has no Client, draw through the real URL, loader, check and caches.
   * Refused while the bridge is open, since two sources would disagree about what a URL names.
   *
   * A raw JSI method, like `setSink`, so that every call into these functions and every read of
   * the bytes they answer with happens on the JS thread, which is the only one that may.
   */
  serveMediaFrom(
    fetchMedia: (messageId: number, index: number) => Promise<ServedMedia>,
    fetchPreview: (messageId: number, index: number) => Promise<ServedPreview>,
  ): void
}

/** What `serveMediaFrom`'s functions answer with. */
export interface ServedMedia {
  contentType: string
  bytes: ArrayBuffer
}
export interface ServedPreview {
  width: number
  height: number
  rgba: ArrayBuffer
}

/**
 * The HybridObject, created on demand.
 *
 * Not created at module scope: importing this file is not the same as wanting a database open,
 * and the app decides when that happens - after it has resolved the key, which it cannot do
 * synchronously.
 */
export function createSessionBridge(): SessionBridge {
  return NitroModules.createHybridObject<Spec>('SessionBridge') as SessionBridge
}
