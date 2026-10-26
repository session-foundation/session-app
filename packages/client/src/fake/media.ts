import { isDisplayableImage, isViewableContentType, isViewableVideo } from '@session/basic-types'
import type { AttachmentRef } from '@session/bridge-types'

import type { MediaSource } from '../types'

import { PHOTO_THUMBHASHES } from './attachments'
import type { FakeSessionClient } from './FakeSessionClient'
import { decodeThumbhash, type Decoded } from './thumbhash'

/**
 * What the fake draws for an attachment, the same on every app that runs it: one of the thirty
 * dev photographs, and that photograph's real ThumbHash for the placeholder.
 *
 * Pixels and names only. How they reach the screen is each app's business, and so is where the
 * photographs live - `pnpm fake-media:fetch` puts them in `~/.cache/session-app/dev-media`.
 */

/** How many dev photographs there are, `unsplash-01.jpg` to `unsplash-30.jpg`. */
export const PHOTO_COUNT = PHOTO_THUMBHASHES.length

/** The number in `unsplash-07.jpg` or `unsplash-07-2.jpg`, or null for any other filename. */
export function photoNumber(filename: string | undefined): string | null {
  const match = /^unsplash-(\d{2})(?:-\d+)?\.(?:jpg|mp4)$/.exec(filename ?? '')
  return match?.[1] ?? null
}

/** A stable photograph for a name that does not carry a number, so every picture has one. */
function assignedNumber(filename: string): string {
  let hash = 0
  for (const char of filename) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return String((hash % PHOTO_COUNT) + 1).padStart(2, '0')
}

function drawnAs(
  client: FakeSessionClient,
  ref: AttachmentRef,
  admits: (contentType: string | undefined) => boolean,
): string | null {
  const attachment = client.locate(ref)?.attachment
  if (attachment === undefined || !admits(attachment.contentType)) return null
  const filename = attachment.filename ?? `attachment-${String(ref.messageId)}-${String(ref.index)}`
  return `unsplash-${photoNumber(filename) ?? assignedNumber(filename)}.jpg`
}

/**
 * The dev photograph an attachment is drawn as, as `unsplash-NN.jpg`, or null when it is not a
 * picture or a video. A video is drawn as its still, and a photograph is a still.
 */
export function photoFileName(client: FakeSessionClient, ref: AttachmentRef): string | null {
  return drawnAs(client, ref, isViewableContentType)
}

/**
 * The dev photograph a thumbnail or placeholder is made from. Wider than `photoFileName`, since
 * libsession thumbnails types the viewer cannot open (AVIF).
 */
function stillFileName(client: FakeSessionClient, ref: AttachmentRef): string | null {
  return drawnAs(client, ref, (type) => isViewableContentType(type) || isDisplayableImage(type))
}

/** Every dev photograph's file name, for an app checking at start that it has them all. */
export function photoFileNames(): string[] {
  return Array.from(
    { length: PHOTO_COUNT },
    (_, at) => `unsplash-${String(at + 1).padStart(2, '0')}.jpg`,
  )
}

/**
 * The thumbnail `pnpm fake-media:fetch` makes of a dev photograph, `thumbnail-07.jpg` for
 * `unsplash-07.jpg`: what libsession would make of it at the fake's edge. Outside the
 * `unsplash-*.jpg` glob, which counts the photographs.
 */
function thumbnailFileName(photo: string): string {
  return photo.replace(/^unsplash-/, 'thumbnail-')
}

/** Every dev thumbnail's file name, checked at start beside the photographs. */
export function thumbnailFileNames(): string[] {
  return photoFileNames().map(thumbnailFileName)
}

function hexBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g)?.map((b) => parseInt(b, 16)) ?? [])
}

/**
 * The placeholder for an attachment: the real hash of the photograph it is drawn as, decoded, so
 * what is drawn is what a recipient would be sent, limits included.
 */
export function fakeThumbhashPixels(client: FakeSessionClient, ref: AttachmentRef): Decoded {
  // As the shim does, in its words: the hash arrived with the message or there is none.
  if (client.locate(ref)?.attachment.hasThumbhash !== true) {
    throw new Error(
      `attachment ${String(ref.index)} of message ${String(ref.messageId)} has no thumbhash`,
    )
  }
  const photo = photoNumber(stillFileName(client, ref) ?? undefined)
  const hash = photo === null ? undefined : PHOTO_THUMBHASHES[Number(photo) - 1]
  if (hash === undefined) throw new Error('no thumbhash: not a picture')
  // The photographs are 4:3; the hash's own ratio is only approximate (lx/ly, one part in seven).
  return decodeThumbhash(hexBytes(hash), 32, 24)
}

/** The shim's sentence for a ref that names nothing; the media source contract holds both to it. */
function refuseUnknown(client: FakeSessionClient, { messageId, index }: AttachmentRef): void {
  if (client.locate({ messageId, index }) !== undefined) return
  throw new Error(`attachment ${String(index)} of message ${String(messageId)} does not exist`)
}

/**
 * The bytes behind each media URL on the fake: what the real bridge's `fetchMedia`,
 * `fetchThumbhash` and `fetchThumbnail` answer. `readPhoto` reads a dev photograph or thumbnail by
 * file name, wherever the app keeps them.
 */
export function createFakeMediaSource(
  client: FakeSessionClient,
  readPhoto: (fileName: string) => Promise<Uint8Array>,
): MediaSource {
  return {
    async fetchMedia(ref) {
      refuseUnknown(client, ref)
      // As the shim does, in its words: from the cache only, so nothing drawn spends data.
      if (!client.isCached(ref)) {
        throw new Error(
          `attachment ${String(ref.index)} of message ${String(ref.messageId)} is not downloaded`,
        )
      }
      const photo = photoFileName(client, ref)
      const declared = client.locate(ref)?.attachment.contentType
      if (photo === null || declared === undefined) throw new Error('not a picture')
      // A video is served its still, which a video type would get refused: nothing here plays one.
      const contentType = isViewableVideo(declared) ? 'image/jpeg' : declared
      return { contentType, bytes: await readPhoto(photo) }
    },
    fetchThumbhash(ref) {
      return new Promise((resolve) => {
        refuseUnknown(client, ref)
        resolve(fakeThumbhashPixels(client, ref))
      })
    },
    async fetchThumbnail(ref) {
      refuseUnknown(client, ref)
      // As the shim does, in its words.
      if (!client.hasThumbnail(ref)) {
        throw new Error(
          `attachment ${String(ref.index)} of message ${String(ref.messageId)} has no thumbnail`,
        )
      }
      const photo = stillFileName(client, ref)
      if (photo === null) throw new Error('not a picture')
      return readPhoto(thumbnailFileName(photo))
    },
  }
}
