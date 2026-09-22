/**
 * The contract, run against the fake.
 *
 * The same suite runs against the real addon in packages/bridge-node once that exists, so
 * the fake cannot drift away from the thing it stands in for without this failing.
 */

import {
  FakeSessionClient,
  friends,
  newcomer as newcomerFixture,
  strangers,
  type FakeWorld,
} from '@session/client/fake'
import type { SessionClient } from '@session/client'
import { describe, expect, it } from 'vitest'

import { runSessionClientContract, type ContractHarness } from '#src/index'

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
    return { client, phrase: await client.getSeedMnemonic() }
  },

  withAttachment() {
    const { world, clients } = friends(['Alice', 'Bob'])
    const alice = clients['Alice']
    if (!alice) throw new Error('fixture did not produce a client')
    const conversationId = world.account('Bob').sessionId
    const account = world.account('Alice')
    const withOne = account.messages(conversationId).find((m) => m.attachments.length > 0)
    if (!withOne) throw new Error('fixture did not seed an attachment')
    return Promise.resolve({
      client: alice,
      conversationId,
      messageId: withOne.id,
      index: 0,
      settle: settleWith(world),
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
