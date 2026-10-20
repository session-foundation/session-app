import { isViewableContentType, isViewableVideo } from '@session/basic-types'
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

/**
 * The dev photograph an attachment is drawn as, as `unsplash-NN.jpg`, or null when it is not a
 * picture or a video. A video is drawn as its still, and a photograph is a still.
 */
export function photoFileName(client: FakeSessionClient, ref: AttachmentRef): string | null {
  const attachment = client.locate(ref)?.attachment
  if (attachment === undefined || !isViewableContentType(attachment.contentType)) return null
  const filename = attachment.filename ?? `attachment-${String(ref.messageId)}-${String(ref.index)}`
  return `unsplash-${photoNumber(filename) ?? assignedNumber(filename)}.jpg`
}

/** Every dev photograph's file name, for an app checking at start that it has them all. */
export function photoFileNames(): string[] {
  return Array.from(
    { length: PHOTO_COUNT },
    (_, at) => `unsplash-${String(at + 1).padStart(2, '0')}.jpg`,
  )
}

function hexBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g)?.map((b) => parseInt(b, 16)) ?? [])
}

/**
 * The placeholder for an attachment: the real hash of the photograph it is drawn as, decoded, so
 * what is drawn is what a recipient would be sent, limits included.
 */
export function fakePreviewPixels(client: FakeSessionClient, ref: AttachmentRef): Decoded {
  // As the shim does, in its words: the hash arrived with the message or there is none.
  if (client.locate(ref)?.attachment.hasPreview !== true) {
    throw new Error(
      `attachment ${String(ref.index)} of message ${String(ref.messageId)} has no preview`,
    )
  }
  const photo = photoNumber(photoFileName(client, ref) ?? undefined)
  const hash = photo === null ? undefined : PHOTO_THUMBHASHES[Number(photo) - 1]
  if (hash === undefined) throw new Error('no preview: not a picture')
  // The photographs are 4:3; the hash's own ratio is only approximate (lx/ly, one part in seven).
  return decodeThumbhash(hexBytes(hash), 32, 24)
}

/** The shim's sentence for a ref that names nothing; the media source contract holds both to it. */
function refuseUnknown(client: FakeSessionClient, { messageId, index }: AttachmentRef): void {
  if (client.locate({ messageId, index }) !== undefined) return
  throw new Error(`attachment ${String(index)} of message ${String(messageId)} does not exist`)
}

/**
 * The bytes behind each media URL on the fake: what the real bridge's `fetchMedia` and
 * `fetchPreview` answer. `readPhoto` reads a dev photograph by file name, wherever the app keeps
 * them.
 */
export function createFakeMediaSource(
  client: FakeSessionClient,
  readPhoto: (fileName: string) => Promise<Uint8Array>,
): MediaSource {
  return {
    async fetchMedia(ref) {
      refuseUnknown(client, ref)
      // Serving the scheme is a fetch: the real bridge fills the cache and announces the change,
      // so bytes handed back without it would leave the picture reported as one nobody has.
      await client.downloadAttachment(ref.messageId, ref.index)
      const photo = photoFileName(client, ref)
      const declared = client.locate(ref)?.attachment.contentType
      if (photo === null || declared === undefined) throw new Error('not a picture')
      // A video is served its still, which a video type would get refused: nothing here plays one.
      const contentType = isViewableVideo(declared) ? 'image/jpeg' : declared
      return { contentType, bytes: await readPhoto(photo) }
    },
    fetchPreview(ref) {
      return new Promise((resolve) => {
        refuseUnknown(client, ref)
        resolve(fakePreviewPixels(client, ref))
      })
    },
  }
}
