import { isViewableImage } from '@session/basic-types'
import { describe, expect, it } from 'vitest'

import { createFakeMediaSource } from '#src/fake/media'
import { friendsWithAttachments, showcase } from '#src/fake/index'

// The photo names are ASCII, so a byte per character stands in for a file's bytes.
const readPhoto = (name: string): Promise<Uint8Array> =>
  Promise.resolve(Uint8Array.from(name, (c) => c.charCodeAt(0)))
const asText = (bytes: Uint8Array): string => String.fromCharCode(...bytes)

async function showcasePhoto() {
  const { world, clients } = showcase()
  const alice = clients['Alice']
  if (!alice) throw new Error('no Alice')
  const { messages } = await alice.getMessages(world.account('Bob').sessionId, { limit: 100 })
  const photo = messages
    .flatMap((m) => m.attachments.map((attachment) => ({ messageId: m.id, attachment })))
    .find((l) => l.attachment.filename?.startsWith('unsplash-01'))
  if (!photo) throw new Error('no photograph in the showcase')
  return { alice, world, ref: { messageId: photo.messageId, index: photo.attachment.index } }
}

describe('the fake media source', () => {
  it('refuses a picture that is not downloaded, and downloads nothing', async () => {
    const { alice, world, ref } = await showcasePhoto()
    await expect(createFakeMediaSource(alice, readPhoto).fetchMedia(ref)).rejects.toThrow(
      `attachment ${String(ref.index)} of message ${String(ref.messageId)} is not downloaded`,
    )
    world.settle()
    expect(alice.isCached(ref)).toBe(false)
  })

  it('answers a picture once it is downloaded', async () => {
    const { alice, world, ref } = await showcasePhoto()
    const downloaded = alice.downloadAttachment(ref.messageId, ref.index)
    world.settle()
    await downloaded
    const media = await createFakeMediaSource(alice, readPhoto).fetchMedia(ref)
    expect(asText(media.bytes)).toBe('unsplash-01.jpg')
  })

  it('serves every picture as a real photograph, whatever its name', async () => {
    const { clients, world } = friendsWithAttachments(['Alice', 'Bob'])
    const alice = clients['Alice']
    if (!alice) throw new Error('no Alice')
    const { messages } = await alice.getMessages(world.account('Bob').sessionId, { limit: 100 })
    const pictures = messages.flatMap((message) =>
      message.attachments
        .filter((a) => isViewableImage(a.contentType))
        .map((a) => ({ messageId: message.id, index: a.index })),
    )
    expect(pictures.length).toBeGreaterThan(0)
    const source = createFakeMediaSource(alice, readPhoto)
    const downloaded = pictures.map((ref) => alice.downloadAttachment(ref.messageId, ref.index))
    world.settle()
    await Promise.all(downloaded)
    for (const media of await Promise.all(pictures.map((ref) => source.fetchMedia(ref)))) {
      expect(asText(media.bytes)).toMatch(/^unsplash-\d{2}\.jpg$/)
    }
  })

  it("answers a placeholder decoded from the photograph's real hash", async () => {
    const { alice, ref } = await showcasePhoto()
    const thumbhash = await createFakeMediaSource(alice, readPhoto).fetchThumbhash(ref)
    // The photographs are 4:3, decoded at 32x24.
    expect(thumbhash).toMatchObject({ width: 32, height: 24 })
    expect(thumbhash.rgba.length).toBe(32 * 24 * 4)
  })

  it('serves the dev thumbnail of a picture once it is downloaded, and refuses it before', async () => {
    const { alice, world, ref } = await showcasePhoto()
    const source = createFakeMediaSource(alice, readPhoto)
    await expect(source.fetchThumbnail(ref)).rejects.toThrow(
      `attachment ${String(ref.index)} of message ${String(ref.messageId)} has no thumbnail`,
    )
    const downloaded = alice.downloadAttachment(ref.messageId, ref.index)
    world.settle()
    await downloaded
    expect(asText(await source.fetchThumbnail(ref))).toBe('thumbnail-01.jpg')
  })

  it('serves a thumbnail of every type it says has one, the AVIF the viewer cannot open included', async () => {
    const { clients, world } = friendsWithAttachments(['Alice', 'Bob'])
    const alice = clients['Alice']
    if (!alice) throw new Error('no Alice')
    const { messages } = await alice.getMessages(world.account('Bob').sessionId, { limit: 100 })
    const refs = messages.flatMap((message) =>
      message.attachments.map((a) => ({ messageId: message.id, index: a.index })),
    )
    const downloaded = refs.map((ref) => alice.downloadAttachment(ref.messageId, ref.index))
    world.settle()
    await Promise.allSettled(downloaded)
    const thumbnailed = refs.filter((ref) => alice.hasThumbnail(ref))
    expect(
      thumbnailed.some((ref) => alice.locate(ref)?.attachment.contentType === 'image/avif'),
    ).toBe(true)
    const source = createFakeMediaSource(alice, readPhoto)
    for (const thumbnail of await Promise.all(
      thumbnailed.map((ref) => source.fetchThumbnail(ref)),
    )) {
      expect(asText(thumbnail)).toMatch(/^thumbnail-\d{2}\.jpg$/)
    }
  })
})
