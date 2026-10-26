import { createFakeMediaSource, friendsWithAttachments, solo } from '@session/client/fake'
import jpeg from 'jpeg-js'
import { describe, expect, it } from 'vitest'

import { runMediaSourceContract, type MediaSourceHarness } from '#src/index'

function grey(width: number, height: number): Uint8Array {
  return jpeg.encode({ width, height, data: new Uint8Array(width * height * 4).fill(0x80) }, 90)
    .data
}

// Real JPEGs, since a thumbnail is checked by its frame header. The original is neither square nor
// within the largest thumbnail edge, 1024, so a thumbnail served from it fails both shape checks.
const ORIGINAL = grey(1280, 960)
const THUMBNAIL = grey(32, 32)

const readPhoto = (fileName: string): Promise<Uint8Array> =>
  Promise.resolve(fileName.startsWith('thumbnail-') ? THUMBNAIL : ORIGINAL)

const harness: MediaSourceHarness = {
  withAttachments() {
    const { world, clients } = friendsWithAttachments(['Alice', 'Bob'], { sets: ['pictures'] })
    const alice = clients['Alice']
    if (!alice) throw new Error('fixture did not produce a client')
    const recipient = world.account('Alice')
    const sender = world.account('Bob')
    const conversationId = sender.sessionId
    const album = recipient.messages(conversationId).find((m) => m.attachments.length > 0)
    const png = album?.attachments.find((a) => a.contentType === 'image/png')
    if (!album || !png?.hasThumbhash) throw new Error('fixture did not seed a hashed PNG')
    const unhashed = recipient.deliverFrom(sender, 'No hash', world.now(), [
      { ...png, index: 0, hasThumbhash: false },
      {
        ...png,
        index: 1,
        contentType: 'application/pdf',
        filename: 'paper.pdf',
        hasThumbhash: false,
      },
      { ...png, index: 2, contentType: 'image/avif', filename: 'scan.avif', hasThumbhash: false },
    ])
    world.settle()
    return Promise.resolve({
      source: createFakeMediaSource(alice, readPhoto),
      client: alice,
      conversationId,
      picture: { messageId: album.id, index: png.index },
      unhashed: { messageId: unhashed.id, index: 0 },
      document: { messageId: unhashed.id, index: 1 },
      avif: { messageId: unhashed.id, index: 2 },
      settle: () => {
        world.settle()
        return Promise.resolve()
      },
    })
  },

  empty() {
    const { clients } = solo('Alice')
    const alice = clients['Alice']
    if (!alice) throw new Error('fixture did not produce a client')
    return Promise.resolve({ source: createFakeMediaSource(alice, readPhoto) })
  },
}

describe('fake', () => {
  runMediaSourceContract(harness, { describe, it, expect })
})
