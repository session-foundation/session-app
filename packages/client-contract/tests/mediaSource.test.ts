import { createFakeMediaSource, friendsWithAttachments, solo } from '@session/client/fake'
import { describe, expect, it } from 'vitest'

import { runMediaSourceContract, type MediaSourceHarness } from '#src/index'

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])

const readPhoto = (): Promise<Uint8Array> => Promise.resolve(JPEG)

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
    if (!album || !png?.hasPreview) throw new Error('fixture did not seed a hashed PNG')
    const unhashed = recipient.deliverFrom(sender, 'No hash', world.now(), [
      { ...png, index: 0, hasPreview: false },
    ])
    world.settle()
    return Promise.resolve({
      source: createFakeMediaSource(alice, readPhoto),
      client: alice,
      conversationId,
      picture: { messageId: album.id, index: png.index },
      unhashed: { messageId: unhashed.id, index: 0 },
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
