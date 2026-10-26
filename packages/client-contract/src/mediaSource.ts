/**
 * What every media source must do: the addon, the Nitro bridge and the fake answer a media URL
 * through it, so a picture drawn on the fake predicts one drawn on libsession. Only the fake can
 * download an incoming attachment offline, so only the fake runs the scenarios that need one.
 *
 * A source answers from libsession's cache only: nothing drawn on screen may spend data, so the
 * one way bytes arrive is a download somebody asked for.
 */

import type { Attachment, AttachmentRef, MediaSource, SessionClient } from '@session/client'

import type { TestFns } from './suite'

export interface MediaSourceHarness {
  /**
   * A source over a client holding two incoming pictures, an AVIF and a PDF, none fetched: one
   * picture sent with a hash, in a type other than the JPEG every dev photograph is, and one sent
   * without.
   */
  withAttachments(): Promise<{
    source: MediaSource
    client: SessionClient
    conversationId: string
    picture: AttachmentRef
    unhashed: AttachmentRef
    document: AttachmentRef
    /** libsession thumbnails an AVIF, though no viewer here opens one. */
    avif: AttachmentRef
    /** Lets whatever is in flight finish: a manual clock, or a real transfer. */
    settle: () => Promise<void>
  }>
  /** A source over a client with no messages at all. */
  empty(): Promise<{ source: MediaSource }>
}

async function failure(call: () => Promise<unknown>): Promise<unknown> {
  try {
    await call()
    return undefined
  } catch (error) {
    return error
  }
}

const NOWHERE: AttachmentRef = { messageId: 987_654_321, index: 0 }

/** What every source says of a ref that names nothing, the file and its thumbhash alike. */
function unknownRefMessage({ messageId, index }: AttachmentRef): string {
  return `attachment ${String(index)} of message ${String(messageId)} does not exist`
}

/** What every source says of an attachment that exists but was sent with no hash. */
function noThumbhashMessage({ messageId, index }: AttachmentRef): string {
  return `attachment ${String(index)} of message ${String(messageId)} has no thumbhash`
}

/** What every source says of an attachment whose file is not cached. */
function notDownloadedMessage({ messageId, index }: AttachmentRef): string {
  return `attachment ${String(index)} of message ${String(messageId)} is not downloaded`
}

/** What every source says of an attachment libsession holds no thumbnail of. */
function noThumbnailMessage({ messageId, index }: AttachmentRef): string {
  return `attachment ${String(index)} of message ${String(messageId)} has no thumbnail`
}

/** Start-of-frame markers, which carry a JPEG's size; C4, C8 and CC share the range and are not. */
const START_OF_FRAME = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

/** A JPEG's size from its frame header, or null when these bytes are not a JPEG that has one. */
function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let at = 2
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return null
    const marker = bytes[at + 1] ?? 0
    const length = ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0)
    if (START_OF_FRAME.has(marker)) {
      const height = ((bytes[at + 5] ?? 0) << 8) | (bytes[at + 6] ?? 0)
      const width = ((bytes[at + 7] ?? 0) << 8) | (bytes[at + 8] ?? 0)
      return { width, height }
    }
    at += 2 + length
  }
  return null
}

/** libsession makes a thumbnail after the bytes are cached, on a worker of its own. */
async function untilThumbnailed(
  client: SessionClient,
  conversationId: string,
  ref: AttachmentRef,
  settle: () => Promise<void>,
): Promise<Attachment | undefined> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await settle()
    const attachment = await attachmentOf(client, conversationId, ref)
    if (attachment?.hasThumbnail === true) return attachment
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return attachmentOf(client, conversationId, ref)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function attachmentOf(
  client: SessionClient,
  conversationId: string,
  { messageId, index }: AttachmentRef,
): Promise<Attachment | undefined> {
  const page = await client.getMessages(conversationId, { limit: 50 })
  return page.messages.find((m) => m.id === messageId)?.attachments.find((a) => a.index === index)
}

export function runMediaSourceContract(
  harness: MediaSourceHarness,
  t: TestFns,
  { unsupported = {} }: { unsupported?: Record<string, string> } = {},
): void {
  const { describe, expect } = t

  function it(name: string, body: () => Promise<void>): void {
    const reason = unsupported[name]
    if (reason === undefined) t.it(name, body)
    else t.it.skip(`${name} - ${reason}`, body)
  }

  describe('media source', () => {
    it('refuses a ref that names nothing, for the file, its thumbhash and its thumbnail', async () => {
      const { source } = await harness.empty()
      const media = await failure(() => source.fetchMedia(NOWHERE))
      const thumbhash = await failure(() => source.fetchThumbhash(NOWHERE))
      const thumbnail = await failure(() => source.fetchThumbnail(NOWHERE))
      expect(media instanceof Error).toBe(true)
      expect(thumbhash instanceof Error).toBe(true)
      expect(thumbnail instanceof Error).toBe(true)
      // One fact, however it is asked for: the thumbhash says no more and no less than the file.
      expect(messageOf(media)).toBe(unknownRefMessage(NOWHERE))
      expect(messageOf(thumbhash)).toBe(unknownRefMessage(NOWHERE))
      expect(messageOf(thumbnail)).toBe(unknownRefMessage(NOWHERE))
    })

    it('answers a downloaded picture with its bytes and the type they were sent as', async () => {
      const { source, client, conversationId, picture, settle } = await harness.withAttachments()
      const downloaded = client.downloadAttachment(picture.messageId, picture.index)
      await settle()
      await downloaded
      const media = await source.fetchMedia(picture)
      expect(media.bytes instanceof Uint8Array).toBe(true)
      expect(media.bytes.length).toBeGreaterThan(0)
      const declared = (await attachmentOf(client, conversationId, picture))?.contentType
      expect(declared?.startsWith('image/')).toBe(true)
      expect(media.contentType).toBe(declared)
    })

    it('refuses a picture that is not downloaded, and starts no transfer', async () => {
      const { source, client, conversationId, picture, settle } = await harness.withAttachments()
      // As it was, whatever that is: the addon's forged pointers carry no url and read unreadable.
      const before = (await attachmentOf(client, conversationId, picture))?.availability
      const reports: unknown[] = []
      const stop = client.onEvent((event) => {
        if (event.type === 'attachment-progress') reports.push(event)
      })
      const refused = await failure(() => source.fetchMedia(picture))
      await settle()
      stop()
      expect(messageOf(refused)).toBe(notDownloadedMessage(picture))
      expect(reports).toEqual([])
      expect(before === 'cached').toBe(false)
      expect((await attachmentOf(client, conversationId, picture))?.availability).toBe(before)
    })

    it('answers a thumbhash as width * height RGBA pixels where the sender sent a hash', async () => {
      const { source, picture } = await harness.withAttachments()
      const thumbhash = await source.fetchThumbhash(picture)
      expect(thumbhash.width).toBeGreaterThan(0)
      expect(thumbhash.height).toBeGreaterThan(0)
      expect(thumbhash.rgba.length).toBe(thumbhash.width * thumbhash.height * 4)
    })

    it('has no thumbhash where the sender sent no hash', async () => {
      const { source, unhashed } = await harness.withAttachments()
      // Exactly this sentence, so a ref that misses the attachment cannot pass on the unknown-ref
      // refusal.
      expect(messageOf(await failure(() => source.fetchThumbhash(unhashed)))).toBe(
        noThumbhashMessage(unhashed),
      )
    })

    it('answers a downloaded picture with a square JPEG thumbnail no larger than the edge', async () => {
      const { source, client, conversationId, picture, settle } = await harness.withAttachments()
      const downloaded = client.downloadAttachment(picture.messageId, picture.index)
      await settle()
      await downloaded
      expect((await untilThumbnailed(client, conversationId, picture, settle))?.hasThumbnail).toBe(
        true,
      )

      const size = jpegSize(await source.fetchThumbnail(picture))
      const edge = await client.getThumbnailEdge()
      expect(size?.width).toBeGreaterThan(0)
      expect(size?.width).toBe(size?.height)
      expect((size?.width ?? Infinity) <= edge).toBe(true)
    })

    it('answers a downloaded AVIF with a JPEG thumbnail, though no viewer here opens one', async () => {
      const { source, client, conversationId, avif, settle } = await harness.withAttachments()
      const downloaded = client.downloadAttachment(avif.messageId, avif.index)
      await settle()
      await downloaded
      expect((await untilThumbnailed(client, conversationId, avif, settle))?.hasThumbnail).toBe(
        true,
      )

      const size = jpegSize(await source.fetchThumbnail(avif))
      expect(size?.width).toBeGreaterThan(0)
      expect(size?.width).toBe(size?.height)
    })

    it('has no thumbnail of a picture not yet downloaded', async () => {
      const { source, client, conversationId, picture } = await harness.withAttachments()
      expect((await attachmentOf(client, conversationId, picture))?.hasThumbnail).toBe(false)
      expect(messageOf(await failure(() => source.fetchThumbnail(picture)))).toBe(
        noThumbnailMessage(picture),
      )
    })

    it('has no thumbnail of a downloaded PDF', async () => {
      const { source, client, conversationId, document, settle } = await harness.withAttachments()
      const downloaded = client.downloadAttachment(document.messageId, document.index)
      await settle()
      await downloaded
      const attachment = await attachmentOf(client, conversationId, document)
      expect(attachment?.availability).toBe('cached')
      expect(attachment?.hasThumbnail).toBe(false)
      expect(messageOf(await failure(() => source.fetchThumbnail(document)))).toBe(
        noThumbnailMessage(document),
      )
    })
  })
}
