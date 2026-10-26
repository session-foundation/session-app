import type { MediaSource } from './types'

/** There are no native image loaders outside the mobile app; desktop serves its own scheme. */
export function serveNativeMediaFrom(_source: MediaSource): void {
  throw new Error('The native image loaders are the mobile app only.')
}
