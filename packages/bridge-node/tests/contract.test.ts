import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createSessionClient, type SessionClient } from '@session/client'
import {
  recoveryWords,
  runSessionClientContract,
  type ContractHarness,
} from '@session/client-contract'
import jpeg from 'jpeg-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createNodeBridgeTransport } from '#src/index'

import { builtForTesting, openPeer, type Peer } from './peer'

/**
 * The contract, run against the real addon with no network - mode B.
 *
 * Nothing reaches a swarm here. The harness carries each message from one client to the other
 * itself, encrypted and fed in through the same path the swarm's would take, which is a port of
 * what libsession's own tests do (tests/test_client/common.hpp). That is what makes this worth
 * running: every layer below the facade is the real one, and the only thing standing in for the
 * network is the delivery, which libsession decrypts and interprets exactly as it would a real
 * message.
 *
 * Skipped unless the addon was built with the test commands compiled in:
 * `pnpm --filter @session/bridge-node build:native:testing`.
 */

/** A grey JPEG, since libsession is handed a real one to decode. */
function grey(width: number, height: number): Uint8Array {
  return jpeg.encode({ width, height, data: new Uint8Array(width * height * 4).fill(0x80) }, 90)
    .data
}

const addon = join(import.meta.dirname, '../build/Release/session_bridge_node.node')

/** Carries everything `from` has written that `to` has not been given yet. */
function carrier(a: Peer, b: Peer): () => Promise<void> {
  const delivered = new Set<string>()

  async function drain(from: Peer, to: Peer): Promise<void> {
    let messages
    try {
      messages = await from.client.getMessages(to.sessionId, { limit: 100 })
    } catch {
      return // No conversation yet, so nothing has been written into it.
    }
    for (const message of messages.messages) {
      const key = `${from.sessionId}:${String(message.id)}`
      if (!message.outgoing || delivered.has(key)) continue
      delivered.add(key)
      await to.ask({
        type: 'deliverTestMessage',
        senderSeedHex: from.seed,
        body: message.body,
        timestamp: message.timestamp,
        ...(message.replyTo === undefined
          ? {}
          : {
              replyTo: { author: message.replyTo.author, timestamp: message.replyTo.timestamp },
            }),
      })
    }
  }

  return async () => {
    await drain(a, b)
    await drain(b, a)
  }
}

const describeAddon = existsSync(addon) && builtForTesting() ? describe : describe.skip

const OFFLINE_ATTACHMENTS =
  'needs a file server to fetch an incoming attachment from; the harness forges pointers only'

describeAddon('addon', () => {
  let root: string
  let sequence = 0
  const open: Peer[] = []
  /** Clients opened outside `openPeer`, closed with the rest. */
  const closeAfter: SessionClient[] = []
  /** Which peer a SessionClient belongs to, so a restart can find the database again. */
  const peers = new Map<SessionClient, Peer>()

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'session-contract-'))
  })

  afterAll(async () => {
    for (const peer of open) peer.client.close()
    for (const client of closeAfter) client.close()
    await rm(root, { recursive: true, force: true })
  })

  async function pair(): Promise<{ alice: Peer; bob: Peer; settle: () => Promise<void> }> {
    sequence += 1
    const alice = await openPeer(join(root, `alice-${String(sequence)}`))
    const bob = await openPeer(join(root, `bob-${String(sequence)}`))
    open.push(alice, bob)
    peers.set(alice.client, alice)
    peers.set(bob.client, bob)
    return { alice, bob, settle: carrier(alice, bob) }
  }

  const harness: ContractHarness = {
    async friends() {
      const { alice, bob, settle } = await pair()
      // Approval is recorded by messages flowing, so a pair that has never written to each
      // other are strangers by definition. This is the setup libsession's own tests use to
      // say "that is not what this scenario is about".
      await alice.ask({ type: 'approveTestContact', sessionId: bob.sessionId })
      await bob.ask({ type: 'approveTestContact', sessionId: alice.sessionId })
      return {
        alice: alice.client,
        bob: bob.client,
        aliceId: alice.sessionId,
        bobId: bob.sessionId,
        settle,
        writeFile: async (name, sizeBytes) => {
          const path = join(alice.dir, name)
          await writeFile(path, Buffer.alloc(sizeBytes, 0x5a))
          return path
        },
        removeFile: (path) => rm(path),
        writePicture: async (name, widthPx, heightPx) => {
          const path = join(alice.dir, name)
          await writeFile(path, grey(widthPx, heightPx))
          return path
        },
        aliceMedia: alice.transport,
      }
    },

    async strangers() {
      const { alice, bob, settle } = await pair()
      await bob.client.sendMessage(alice.sessionId, { body: 'let me in' })
      await settle()
      return { alice: alice.client, bob: bob.client, bobId: bob.sessionId, settle }
    },

    async newcomer() {
      sequence += 1
      // Its own database, opened deferred: this is the only harness entry that has to reach a
      // client with no identity, because it is the only scenario about not having one yet.
      const peer = await openPeer(join(root, `newcomer-${String(sequence)}`), { deferred: true })
      open.push(peer)
      // Registered so `restart` can find it: the sweep scenarios restart a newcomer, and a
      // restart has to reopen deferred or libsession mints a fresh account on the way back up and
      // the question the test is asking disappears.
      peers.set(peer.client, peer)
      const client = peer.client

      // A phrase libsession really issued, from an account made and thrown away for the purpose.
      // Nothing else can produce one: the word list is libsession's.
      const source = await openPeer(join(root, `phrase-${String(sequence)}`))
      open.push(source)
      const phrase = await recoveryWords(source.client)

      return { client, phrase }
    },

    withAttachment() {
      // No file server here, so an attachment deliverTestMessage forges can never download; the
      // scenarios built on this are skipped below.
      return Promise.reject(
        new Error('the offline addon harness cannot produce an incoming attachment'),
      )
    },

    async receivesAttachments() {
      const { alice, bob } = await pair()
      await alice.ask({ type: 'approveTestContact', sessionId: bob.sessionId })
      let sent = 0
      return {
        client: alice.client,
        conversationId: bob.sessionId,
        async receive(contentTypes: readonly string[]) {
          sent += 1
          const body = `attachments ${String(sent)}`
          const delivered = await alice.ask({
            type: 'deliverTestMessage',
            senderSeedHex: bob.seed,
            body,
            timestamp: Date.now() + sent,
            attachments: contentTypes.map((contentType) => ({ contentType })),
          })
          if (delivered.error !== undefined) throw new Error(delivered.error)
          const page = await alice.client.getMessages(bob.sessionId, { limit: 5 })
          const message = page.messages.find((m) => m.body === body)
          if (!message) throw new Error('the forged message did not arrive')
          return message
        },
      }
    },

    async receivesMessages() {
      const { alice, bob } = await pair()
      await alice.ask({ type: 'approveTestContact', sessionId: bob.sessionId })
      return {
        client: alice.client,
        conversationId: bob.sessionId,
        async receive({ body, timestamp, replyTo }) {
          const delivered = await alice.ask({
            type: 'deliverTestMessage',
            senderSeedHex: bob.seed,
            body,
            timestamp,
            ...(replyTo === undefined ? {} : { replyTo }),
          })
          if (delivered.error !== undefined) throw new Error(delivered.error)
        },
      }
    },

    async unopenable() {
      sequence += 1
      // A database libsession wrote, opened again under a different key: the real way one stops
      // opening. Deferred on the second open, so the fresh database a discard makes has no account.
      const dir = join(root, `unopenable-${String(sequence)}`)
      const first = await openPeer(dir)
      first.client.close()
      const transport = createNodeBridgeTransport({
        dbPath: join(dir, 'session.db'),
        cacheDir: join(dir, 'cache'),
        rawKey: new Uint8Array(32).fill(12),
        deferAccount: true,
      })
      const client = createSessionClient(transport)
      closeAfter.push(client)
      return client
    },

    async restart(client: SessionClient) {
      const peer = peers.get(client)
      if (!peer) throw new Error('restart was given a client this harness did not open')
      // The real thing: the process goes, the database stays. Anything libsession had in
      // flight is gone with it, which is what puts a send into `interrupted`.
      client.close()
      const reopened = await openPeer(peer.dir, { deferred: peer.deferred })
      open.push(reopened)
      peers.set(reopened.client, reopened)
      return reopened.client
    },
  }

  runSessionClientContract(
    harness,
    { describe, it, expect },
    {
      unsupported: {
        'moves an approved request between the two lists':
          'approveConversation has no libsession counterpart; see docs/STATUS.md',
        'reports a download from nothing to a result': OFFLINE_ATTACHMENTS,
        'answers a download of what is already here without reporting again': OFFLINE_ATTACHMENTS,
        'reports an export as its own transfer': OFFLINE_ATTACHMENTS,
        'answers a page with what its attachments are doing': OFFLINE_ATTACHMENTS,
        'counts a downloaded attachment in the cache size': OFFLINE_ATTACHMENTS,
        'remembers being told to download nothing, which is not the same as never asking':
          OFFLINE_ATTACHMENTS,
        'refuses a download of a file the server no longer holds, before any transfer starts':
          OFFLINE_ATTACHMENTS,
        'refuses an attachment index the message does not have': OFFLINE_ATTACHMENTS,
        'announces an attachment as fetching while its download runs': OFFLINE_ATTACHMENTS,
        'joins a running download, and ends it once per handler': OFFLINE_ATTACHMENTS,
        'fetches an arriving image unasked once told to fetch images': OFFLINE_ATTACHMENTS,
        'says when it will make no rendition of a picture it holds': OFFLINE_ATTACHMENTS,
        'exports beside a file already written rather than over it, unless told to replace':
          OFFLINE_ATTACHMENTS,
        'fetches an uncached export into the cache, reading as fetching meanwhile':
          OFFLINE_ATTACHMENTS,
        'joins an export to a running download': OFFLINE_ATTACHMENTS,
        'joins a download to a running export': OFFLINE_ATTACHMENTS,
        'withdraws what was asked of an attachment once it is deleted': OFFLINE_ATTACHMENTS,
        'reports a reply again when a thumbnail of the picture it answers is made':
          OFFLINE_ATTACHMENTS,
        'delivers the files of a message to the other side once they are up':
          'needs a file server to upload to; offline every upload fails',
      },
    },
  )
})
