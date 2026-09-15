import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createSessionClient, discoverSeedNodes } from '@session/client'
import { describe, expect, it } from 'vitest'

import { createNodeBridgeTransport } from '#src/index'

/**
 * Attaches one real bridge to a real local devnet, and says whether it worked.
 *
 * Not a test of anything - a tool, shaped as one because it needs the addon and vitest is what
 * already loads it. It answers the question neither the contract suite nor a unit test can: that
 * the seed nodes a devnet advertises are ones libsession can actually bootstrap from. Every
 * refusal is covered offline; only this covers an acceptance.
 *
 *     EXPO_PUBLIC_SESSION_DEVNET_SEED_URL=http://192.168.1.114:1280 \
 *       pnpm --filter @session/bridge-node exec vitest run tests/devnet
 *
 * Skipped without that variable, so `pnpm test` never opens a socket.
 */
const seedUrl = process.env['EXPO_PUBLIC_SESSION_DEVNET_SEED_URL']

describe.skipIf(seedUrl === undefined)('a local devnet', () => {
  it('attaches, and libsession says so', async () => {
    if (seedUrl === undefined) throw new Error('unreachable: the suite is skipped without it')

    const seedNodes = await discoverSeedNodes(seedUrl, {
      fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(8_000) }),
      variable: 'EXPO_PUBLIC_SESSION_DEVNET_SEED_URL',
    })
    console.log(`discovered ${String(seedNodes.length)} seed node(s):`, seedNodes)
    expect(seedNodes.length).toBeGreaterThan(0)

    const dir = mkdtempSync(join(tmpdir(), 'session-devnet-'))
    mkdirSync(join(dir, 'cache'), { recursive: true })

    const transport = createNodeBridgeTransport({
      dbPath: join(dir, 'session.db'),
      cacheDir: join(dir, 'cache'),
      rawKey: new Uint8Array(32).fill(7),
      deferAccount: true,
      netid: 'devnet',
      seedNodes,
      deviceType: 'desktop',
      // `network` alone, because a flat debug is a thousand lines of quic per run.
      logLevel: 'warn',
      logCategories: [{ category: 'network', level: 'debug' }],
    })

    // `networkAttached` is a boolean: it says a network attached, not which one, and mainnet
    // would set it just the same. libsession names what it configured in its own log, so that
    // is what gets asserted.
    const lines: string[] = []
    const client = createSessionClient({
      ...transport,
      setSink(handler) {
        transport.setSink((frame) => {
          if (frame.type === 'event' && frame.event.type === 'log') lines.push(frame.event.message)
          handler(frame)
        })
      },
    })

    try {
      await client.createAccount()
      const info = await client.getAccountInfo()
      console.log(
        `devnet account ${info.sessionId ?? '(none)'}, attached ${String(info.networkAttached)}`,
      )
      expect(info.haveAccount).toBe(true)
      expect(info.networkAttached).toBe(true)

      const joined = lines.join('\n')
      expect(joined).toMatch(/Network config set to devnet with \d+ seed node\(s\)/)
      // Session Router refuses a devnet, so this is the only transport it can be on.
      expect(joined).toContain('route requests using Onion Requests')
    } finally {
      client.close()
    }
  }, 60_000)

  it('carries a message between two accounts on it', async () => {
    if (seedUrl === undefined) throw new Error('unreachable: the suite is skipped without it')

    const seedNodes = await discoverSeedNodes(seedUrl, {
      fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(8_000) }),
    })

    const open = (fill: number) => {
      const dir = mkdtempSync(join(tmpdir(), 'session-devnet-'))
      mkdirSync(join(dir, 'cache'), { recursive: true })
      return createSessionClient(
        createNodeBridgeTransport({
          dbPath: join(dir, 'session.db'),
          cacheDir: join(dir, 'cache'),
          rawKey: new Uint8Array(32).fill(fill),
          deferAccount: true,
          netid: 'devnet',
          seedNodes,
          deviceType: 'desktop',
        }),
      )
    }

    const alice = open(11)
    const bob = open(12)

    try {
      await alice.createAccount()
      await bob.createAccount()
      const bobId = (await bob.getAccountInfo()).sessionId ?? ''
      const aliceId = (await alice.getAccountInfo()).sessionId ?? ''
      console.log(`alice ${aliceId}\nbob   ${bobId}`)

      const conversation = await alice.openDm(bobId)

      /**
       * Sends one message and says how long it took to land.
       *
       * Asking before waiting, and waiting only when the answer was no: a sleep at the top of the
       * loop is a floor on whatever this reports, so at 3s it could only ever say "3 seconds" for
       * a devnet that delivers in half of one.
       */
      const roundTrip = async (body: string, within: number): Promise<number> => {
        const started = Date.now()
        await alice.sendMessage(conversation, { body })
        const deadline = started + within
        while (Date.now() < deadline) {
          const { messages } = await bob.getMessages(aliceId)
          if (messages.some((message) => message.body === body)) return Date.now() - started
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        return -1
      }

      // The first one pays for the routers: each side builds its paths after attaching, and a
      // handshake started inside that window times out rather than waiting. Nothing about it is
      // worth timing, only that it eventually lands - observed between 0.5s and 34s on the same
      // devnet minutes apart, which is why it gets the whole budget and no bound.
      const first = await roundTrip(`devnet warm up ${String(Date.now())}`, 90_000)
      console.log(`first message: ${first === -1 ? 'never arrived' : `${String(first)}ms`}`)
      expect(first).toBeGreaterThan(-1)

      // With the paths up, this is the poll interval and one machine's worth of network: observed
      // at 455-960ms, against the 500ms a devnet polls at.
      //
      // The bound is 5s rather than 1s on purpose. What is worth catching is the poll interval
      // going back to libsession's 20-second default, and 5s separates those two regimes with
      // room to spare. A 1s bound would instead measure this machine's jitter - 960ms of the
      // observed spread was that - and fail for reasons that say nothing about the code.
      const second = await roundTrip(`devnet round trip ${String(Date.now())}`, 10_000)
      console.log(`second message: ${second === -1 ? 'never arrived' : `${String(second)}ms`}`)
      expect(second).toBeGreaterThan(-1)
      expect(second).toBeLessThan(5_000)
    } finally {
      alice.close()
      bob.close()
    }
  }, 180_000)
})
