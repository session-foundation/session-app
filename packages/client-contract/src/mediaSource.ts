/**
 * What every media source must do: the addon, the Nitro bridge and the fake answer a media URL
 * through it, so a picture drawn on the fake predicts one drawn on libsession. Only the fake can
 * serve an incoming attachment's bytes offline, so only the fake runs the scenarios that fetch one.
 */

import type { Attachment, AttachmentRef, MediaSource, SessionClient } from '@session/client'

import type { TestFns } from './suite'

export interface MediaSourceHarness {
  /**
   * A source over a client holding two incoming pictures, neither fetched: one sent with a hash,
   * in a type other than the JPEG every dev photograph is, and one sent without a hash.
   */
  withAttachments(): Promise<{
    source: MediaSource
    client: SessionClient
    conversationId: string
    picture: AttachmentRef
    unhashed: AttachmentRef
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

/** What every source says of a ref that names nothing, the file and its preview alike. */
function unknownRefMessage({ messageId, index }: AttachmentRef): string {
  return `attachment ${String(index)} of message ${String(messageId)} does not exist`
}

/** What every source says of an attachment that exists but was sent with no hash. */
function noPreviewMessage({ messageId, index }: AttachmentRef): string {
  return `attachment ${String(index)} of message ${String(messageId)} has no preview`
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
    it('refuses a ref that names nothing, for the file and for its preview', async () => {
      const { source } = await harness.empty()
      const media = await failure(() => source.fetchMedia(NOWHERE))
      const preview = await failure(() => source.fetchPreview(NOWHERE))
      expect(media instanceof Error).toBe(true)
      expect(preview instanceof Error).toBe(true)
      // One fact, however it is asked for: the preview says no more and no less than the file.
      expect(messageOf(media)).toBe(unknownRefMessage(NOWHERE))
      expect(messageOf(preview)).toBe(unknownRefMessage(NOWHERE))
    })

    it('answers a picture with its bytes and the type they were sent as', async () => {
      const { source, client, conversationId, picture, settle } = await harness.withAttachments()
      const answer = source.fetchMedia(picture)
      await settle()
      const media = await answer
      expect(media.bytes instanceof Uint8Array).toBe(true)
      expect(media.bytes.length).toBeGreaterThan(0)
      const declared = (await attachmentOf(client, conversationId, picture))?.contentType
      expect(declared?.startsWith('image/')).toBe(true)
      expect(media.contentType).toBe(declared)
    })

    it('reports a picture as cached once its bytes have been served', async () => {
      const { source, client, conversationId, picture, settle } = await harness.withAttachments()
      const answer = source.fetchMedia(picture)
      await settle()
      await answer
      const attachment = await attachmentOf(client, conversationId, picture)
      expect(attachment?.availability).toBe('cached')
    })

    it('answers a preview as width * height RGBA pixels where the sender sent a hash', async () => {
      const { source, picture } = await harness.withAttachments()
      const preview = await source.fetchPreview(picture)
      expect(preview.width).toBeGreaterThan(0)
      expect(preview.height).toBeGreaterThan(0)
      expect(preview.rgba.length).toBe(preview.width * preview.height * 4)
    })

    it('has no preview where the sender sent no hash', async () => {
      const { source, unhashed } = await harness.withAttachments()
      // Exactly this sentence, so a ref that misses the attachment cannot pass on the unknown-ref
      // refusal.
      expect(messageOf(await failure(() => source.fetchPreview(unhashed)))).toBe(
        noPreviewMessage(unhashed),
      )
    })
  })
}
