import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Command, Frame, Response } from '@session/bridge-types'
import { createSessionClient, type BridgeTransport, type SessionClient } from '@session/client'
import { runSessionClientContract, type ContractHarness } from '@session/client-contract'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createNodeBridgeTransport } from '#src/index'

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

const addon = join(import.meta.dirname, '../build/Release/session_bridge_node.node')

/**
 * Splits one frame stream in two: the facade's, and the harness's own.
 *
 * The test-only commands must not go through SessionClient - they are not things the app can
 * do, and putting them on that interface would be the first crack in it. So they ride the same
 * transport on request ids the facade will not reach, and their responses are taken off the
 * stream before the facade ever sees them.
 */
function tap(transport: BridgeTransport): {
  forFacade: BridgeTransport
  ask: (command: Command) => Promise<Response>
} {
  let facadeSink: ((frame: Frame) => void) | null = null
  const buffered: Frame[] = []
  const waiting = new Map<number, (response: Response) => void>()
  let nextId = 1_000_000

  transport.setSink((frame) => {
    if (frame.type === 'response') {
      const resolve = waiting.get(frame.response.id)
      if (resolve) {
        waiting.delete(frame.response.id)
        resolve(frame.response)
        return
      }
    }
    if (facadeSink) facadeSink(frame)
    else buffered.push(frame)
  })

  return {
    forFacade: {
      send: (request) => {
        transport.send(request)
      },
      setSink: (onFrame) => {
        facadeSink = onFrame
        for (const frame of buffered.splice(0, buffered.length)) onFrame(frame)
      },
      close: () => {
        transport.close()
      },
    },
    ask: (command) =>
      new Promise<Response>((resolve) => {
        const id = nextId++
        waiting.set(id, resolve)
        transport.send({ id, command })
      }),
  }
}

interface Peer {
  client: SessionClient
  ask: (command: Command) => Promise<Response>
  sessionId: string
  seed: string
  dir: string
}

async function openPeer(dir: string): Promise<Peer> {
  await mkdir(join(dir, 'cache'), { recursive: true })
  const transport = createNodeBridgeTransport({
    dbPath: join(dir, 'session.db'),
    cacheDir: join(dir, 'cache'),
    rawKey: new Uint8Array(32).fill(11),
    // Eagerly, because a peer is only useful once it has an identity to send from.
    deferAccount: false,
  })
  const { forFacade, ask } = tap(transport)
  const client = createSessionClient(forFacade)

  const info = await client.getAccountInfo()
  const seed = await ask({ type: 'getTestAccountSeed' })
  if (seed.result?.type !== 'hex') throw new Error(seed.error ?? 'no seed: build with testing on')

  return {
    client,
    ask,
    sessionId: info.sessionId ?? '',
    seed: seed.result.hex,
    dir,
  }
}

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
    for (const message of messages) {
      const key = `${from.sessionId}:${String(message.id)}`
      if (!message.outgoing || delivered.has(key)) continue
      delivered.add(key)
      await to.ask({
        type: 'deliverTestMessage',
        senderSeedHex: from.seed,
        body: message.body,
        timestamp: message.timestamp,
      })
    }
  }

  return async () => {
    await drain(a, b)
    await drain(b, a)
  }
}

/**
 * Whether the addon that exists was built with the test commands in it.
 *
 * Read from the CMake cache beside it rather than by asking the addon, because a build without
 * them answers "the bridge does not implement this command yet" - which is indistinguishable
 * from a real regression, and would be reported as one.
 */
function builtForTesting(): boolean {
  try {
    const cache = readFileSync(join(import.meta.dirname, '../build/CMakeCache.txt'), 'utf8')
    return /^SESSION_BRIDGE_TESTING:BOOL=ON$/m.test(cache)
  } catch {
    return false
  }
}

const describeAddon = existsSync(addon) && builtForTesting() ? describe : describe.skip

const OFFLINE_ATTACHMENTS =
  'needs an incoming attachment and a file server to fetch it from; the harness forges bodies only'

describeAddon('addon', () => {
  let root: string
  let sequence = 0
  const open: Peer[] = []
  /** Which peer a SessionClient belongs to, so a restart can find the database again. */
  const peers = new Map<SessionClient, Peer>()

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'session-contract-'))
  })

  afterAll(async () => {
    for (const peer of open) peer.client.close()
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
      }
    },

    async strangers() {
      const { alice, bob, settle } = await pair()
      await bob.client.sendMessage(alice.sessionId, { body: 'let me in' })
      await settle()
      return { alice: alice.client, bob: bob.client, bobId: bob.sessionId, settle }
    },

    withAttachment() {
      // deliverTestMessage forges a body-only DM, which is the whole of what the harness can
      // put into a database with no network: there is no attachment to fetch, and no file
      // server to fetch it from. The scenarios that need one are skipped below.
      return Promise.reject(
        new Error('the offline addon harness cannot produce an incoming attachment'),
      )
    },

    async restart(client: SessionClient) {
      const peer = peers.get(client)
      if (!peer) throw new Error('restart was given a client this harness did not open')
      // The real thing: the process goes, the database stays. Anything libsession had in
      // flight is gone with it, which is what puts a send into `interrupted`.
      client.close()
      const reopened = await openPeer(peer.dir)
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
        'reports a save as its own transfer': OFFLINE_ATTACHMENTS,
        'remembers being told to download nothing, which is not the same as never asking':
          OFFLINE_ATTACHMENTS,
      },
    },
  )
})
