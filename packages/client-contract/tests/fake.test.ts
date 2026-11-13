/**
 * The contract, run against the fake.
 *
 * The same suite runs against the real addon in packages/bridge-node once that exists, so
 * the fake cannot drift away from the thing it stands in for without this failing.
 */

import {
  createFakeMediaSource,
  FakeSessionClient,
  friends,
  friendsWithAttachments,
  newcomer as newcomerFixture,
  strangers,
  unopenable,
  type FakeWorld,
} from '@session/client/fake'
import type { Attachment, SessionClient } from '@session/client'
import { describe, expect, it } from 'vitest'

import { recoveryWords, runSessionClientContract, type ContractHarness } from '#src/index'

const ARRIVING_IMAGE: Attachment = {
  index: 0,
  contentType: 'image/jpeg',
  filename: 'arriving.jpg',
  sizeBytes: 150_000,
  voiceMessage: false,
  width: 1200,
  height: 900,
  hasThumbhash: false,
  hasThumbnail: false,
  thumbnailWidthPx: 0,
  thumbnailHeightPx: 0,
  hasRendition: false,
  renditionRefused: false,
  originalFile: false,
  uploaded: true,
  availability: 'absent',
  fetchDoneBytes: 0,
  fetchTotalBytes: 0,
}

/** The fake's clock is manual, so settling is synchronous and cannot race. */
function settleWith(world: FakeWorld): () => Promise<void> {
  return () => {
    world.settle()
    return Promise.resolve()
  }
}

const harness: ContractHarness = {
  friends() {
    const { world, clients } = friends(['Alice', 'Bob'])
    const alice = clients['Alice']
    const bob = clients['Bob']
    if (!alice || !bob) throw new Error('fixture did not produce both clients')
    return Promise.resolve({
      alice,
      bob,
      aliceId: world.account('Alice').sessionId,
      bobId: world.account('Bob').sessionId,
      settle: settleWith(world),
      writeFile: (name, sizeBytes) => {
        const path = `/fake-disk/${name}`
        world.writeFile(path, sizeBytes)
        return Promise.resolve(path)
      },
      removeFile: (path) => {
        world.removeFile(path)
        return Promise.resolve()
      },
      writePicture: (name) => {
        const path = `/fake-disk/${name}`
        world.writeFile(path, 48_000)
        return Promise.resolve(path)
      },
      aliceMedia: createFakeMediaSource(
        alice,
        () => Promise.reject(new Error('no photographs here')),
        () => Promise.reject(new Error('ENOENT')),
      ),
    })
  },

  strangers() {
    const { world, clients } = strangers(['Alice', 'Bob'])
    const alice = clients['Alice']
    const bob = clients['Bob']
    if (!alice || !bob) throw new Error('fixture did not produce both clients')
    return Promise.resolve({
      alice,
      bob,
      bobId: world.account('Bob').sessionId,
      settle: settleWith(world),
    })
  },

  async newcomer() {
    const { clients } = newcomerFixture()
    const client = Object.values(clients)[0]
    if (!client) throw new Error('fixture did not produce a client')
    // The fake's own phrase, which is the only one it can be asked to agree is genuine.
    return { client, phrase: await recoveryWords(client) }
  },

  unopenable() {
    const { clients } = newcomerFixture()
    const client = Object.values(clients)[0]
    if (!client) throw new Error('fixture did not produce a client')
    return Promise.resolve(unopenable(client, 'file is not a database'))
  },

  withAttachment(options = {}) {
    const { world, clients } = friendsWithAttachments(['Alice', 'Bob'], {
      sets: [options.expired === true ? 'expired' : 'pictures'],
    })
    const alice = clients['Alice']
    if (!alice) throw new Error('fixture did not produce a client')
    const conversationId = world.account('Bob').sessionId
    const account = world.account('Alice')
    const withOne =
      options.pastPixelLimits === true
        ? account.deliverFrom(world.account('Bob'), 'Huge', world.now(), [
            { ...ARRIVING_IMAGE, width: 20_000, height: 20_000 },
          ])
        : account.messages(conversationId).find((m) => m.attachments.length > 0)
    if (!withOne) throw new Error('fixture did not seed an attachment')
    return Promise.resolve({
      client: alice,
      conversationId,
      messageId: withOne.id,
      index: 0,
      settle: settleWith(world),
      receiveImage: () =>
        Promise.resolve(
          account.deliverFrom(world.account('Bob'), 'One more', world.now(), [ARRIVING_IMAGE]).id,
        ),
    })
  },

  receivesAttachments() {
    const { world, clients } = friends(['Alice', 'Bob'])
    const alice = clients['Alice']
    if (!alice) throw new Error('fixture did not produce a client')
    const bob = world.account('Bob')
    return Promise.resolve({
      client: alice,
      conversationId: bob.sessionId,
      async receive(contentTypes: readonly string[]) {
        const attachments = contentTypes.map((contentType, index): Attachment => ({
          ...ARRIVING_IMAGE,
          index,
          contentType,
        }))
        const { id } = world.account('Alice').deliverFrom(bob, '', world.now(), attachments)
        const page = await alice.getMessages(bob.sessionId, { limit: 1 })
        const message = page.messages.find((m) => m.id === id)
        if (!message) throw new Error('the delivered message is not the newest')
        return message
      },
    })
  },

  receivesMessages() {
    const { world, clients } = friends(['Alice', 'Bob'])
    const alice = clients['Alice']
    if (!alice) throw new Error('fixture did not produce a client')
    const bob = world.account('Bob')
    return Promise.resolve({
      client: alice,
      conversationId: bob.sessionId,
      receive({ body, timestamp, replyTo }) {
        world.account('Alice').deliverFrom(bob, body, timestamp, [], replyTo)
        return Promise.resolve()
      },
    })
  },

  restart(client: SessionClient) {
    if (!(client instanceof FakeSessionClient)) {
      throw new Error('the fake harness can only restart a fake client')
    }
    return Promise.resolve(client.restart())
  },
}

describe('fake', () => {
  runSessionClientContract(harness, { describe, it, expect })
})
