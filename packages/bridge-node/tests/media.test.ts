import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  MEDIA_URL_VECTORS,
  runMediaSourceContract,
  SERVABLE_VECTORS,
  type MediaSourceHarness,
  type MediaUrlVector,
} from '@session/client-contract'
import { PHOTO_THUMBHASHES } from '@session/client/fake'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createNodeBridgeTransport } from '#src/index'

import { builtForTesting, openPeer } from './peer'

/**
 * The shim's media rules and the addon's media source, against the vectors and the contract the
 * TypeScript and the fake answer. Skipped when the addon has not been built, as addon.test.ts is.
 */
const addon = join(import.meta.dirname, '../build/Release/session_bridge_node.node')
const describeAddon = existsSync(addon) ? describe : describe.skip

interface MediaRules {
  parseMediaUrl(url: string): MediaUrlVector['parsed']
  servableContentType(declared: string, bytes: Uint8Array): string | null
}

describeAddon('the shim media rules', () => {
  // A skipped suite still runs its body to collect tests, so the load waits for beforeAll.
  let rules: MediaRules
  beforeAll(() => {
    rules = createRequire(import.meta.url)(addon) as MediaRules
  })

  it('parse media urls as every parser of the scheme does', () => {
    for (const { url, parsed } of MEDIA_URL_VECTORS) {
      expect(rules.parseMediaUrl(url), url).toEqual(parsed)
    }
  })

  it('serve and refuse bytes as every servable check does', () => {
    for (const { declared, bytes, served } of SERVABLE_VECTORS) {
      expect(
        rules.servableContentType(declared, bytes),
        `${declared} ${String(bytes.length)}`,
      ).toBe(served)
    }
  })
})

const OFFLINE_ATTACHMENTS =
  'needs a file server to fetch an incoming attachment from; the harness forges pointers only'

const NEEDS_TEST_COMMANDS = 'needs the test commands: build:native:testing'

const forges = builtForTesting()

describeAddon('addon', () => {
  let root: string
  let sequence = 0
  const open: { close: () => void }[] = []

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'session-media-'))
  })

  afterAll(async () => {
    for (const transport of open) transport.close()
    await rm(root, { recursive: true, force: true })
  })

  const harness: MediaSourceHarness = {
    async withAttachments() {
      sequence += 1
      const recipient = await openPeer(join(root, `recipient-${String(sequence)}`))
      const sender = await openPeer(join(root, `sender-${String(sequence)}`))
      open.push(recipient.client, sender.client)

      const hash = PHOTO_THUMBHASHES[0]
      if (hash === undefined) throw new Error('the fake has no photo hashes')
      const body = 'two pictures, one hashed, a PDF and an AVIF'
      const delivered = await recipient.ask({
        type: 'deliverTestMessage',
        senderSeedHex: sender.seed,
        body,
        timestamp: Date.now(),
        attachments: [
          { contentType: 'image/png', thumbhash: Buffer.from(hash, 'hex') },
          { contentType: 'image/png' },
          { contentType: 'application/pdf' },
          { contentType: 'image/avif' },
        ],
      })
      if (delivered.error !== undefined) throw new Error(delivered.error)

      const page = await recipient.client.getMessages(sender.sessionId, { limit: 10 })
      const message = page.messages.find((m) => m.body === body)
      if (!message) throw new Error('the forged message did not arrive')
      return {
        source: recipient.transport,
        client: recipient.client,
        conversationId: sender.sessionId,
        picture: { messageId: message.id, index: 0 },
        unhashed: { messageId: message.id, index: 1 },
        document: { messageId: message.id, index: 2 },
        avif: { messageId: message.id, index: 3 },
        settle: () => Promise.resolve(),
      }
    },

    async empty() {
      sequence += 1
      const dir = join(root, `empty-${String(sequence)}`)
      await mkdir(join(dir, 'cache'), { recursive: true })
      const transport = createNodeBridgeTransport({
        dbPath: join(dir, 'session.db'),
        cacheDir: join(dir, 'cache'),
        rawKey: new Uint8Array(32).fill(5),
        deferAccount: true,
      })
      open.push(transport)
      return { source: transport }
    },
  }

  runMediaSourceContract(
    harness,
    { describe, it, expect },
    {
      unsupported: {
        'answers a downloaded picture with its bytes and the type they were sent as':
          OFFLINE_ATTACHMENTS,
        'answers a downloaded picture with a square JPEG thumbnail no larger than the edge':
          OFFLINE_ATTACHMENTS,
        'has no thumbnail of a downloaded PDF': OFFLINE_ATTACHMENTS,
        'answers a downloaded AVIF with a JPEG thumbnail, though no viewer here opens one':
          OFFLINE_ATTACHMENTS,
        ...(forges
          ? {}
          : {
              'answers a thumbhash as width * height RGBA pixels where the sender sent a hash':
                NEEDS_TEST_COMMANDS,
              'has no thumbhash where the sender sent no hash': NEEDS_TEST_COMMANDS,
              'has no thumbnail of a picture not yet downloaded': NEEDS_TEST_COMMANDS,
              'refuses a picture that is not downloaded, and starts no transfer':
                NEEDS_TEST_COMMANDS,
            }),
      },
    },
  )
})
