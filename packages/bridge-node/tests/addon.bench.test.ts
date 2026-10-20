import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createNodeBridgeTransport } from '#src/index'
import { createSessionClient, type SessionClient } from '@session/client'
import { afterAll, beforeAll, describe, it } from 'vitest'

import { accountId } from '@session/bench/fixtures'
import { ms, report, table } from '@session/bench/measure'

/**
 * Tier two: the same measurements with the real C++ in the path.
 *
 * Everything tier one measured happens here too, plus what it could not reach - libsession
 * reading sqlite, encode.cpp writing the wire types, protobuf serialising, and the thread-safe
 * function carrying each frame from Core's loop to the JavaScript thread. Subtracting tier one
 * from these numbers is what the C++ half costs.
 *
 * No Electron and no network. Skipped unless the addon has been built, because the per-PR job
 * does not build the addon.
 */

const addon = join(import.meta.dirname, '../build/Release/session_bridge_node.node')
const describeAddon = existsSync(addon) ? describe : describe.skip

describeAddon('the addon, with real libsession', () => {
  let dir: string
  let client: SessionClient

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'session-bench-'))
    await mkdir(join(dir, 'cache'), { recursive: true })
    client = createSessionClient(
      createNodeBridgeTransport({
        dbPath: join(dir, 'session.db'),
        cacheDir: join(dir, 'cache'),
        rawKey: new Uint8Array(32).fill(5),
        // An identity is needed before a conversation can be opened against one.
        deferAccount: false,
      }),
    )
    await client.getAccountInfo()
  }, 120_000)

  afterAll(async () => {
    client.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('getConversations, end to end through the C++', async () => {
    const rows: string[][] = []
    let random = seeded(7)
    let opened = 0
    /** A real conversation to ask about, for the small command that goes on libsession's loop. */
    let someConversation = ''

    // The same four sizes every table in this suite uses, so the rows line up across tiers.
    for (const target of [100, 500, 1000, 5000]) {
      while (opened < target) {
        const id = await client.openDm(accountId(random))
        if (!someConversation) someConversation = id
        opened++
      }

      const times: number[] = []
      for (let i = 0; i < 12; i++) {
        const start = performance.now()
        await client.getConversations()
        times.push(performance.now() - start)
      }
      times.sort((a, b) => a - b)

      // Two small commands, because the shim does not treat them alike. `getConversation` goes
      // through `Client::_async`, which is `loop.call`, so it queues on the same single loop the
      // big read is occupying. `getPref` is answered inline in the shim from `core.globals` and
      // never reaches that loop. Only the first can be blocked - and measuring the second was the
      // mistake in the previous version of this benchmark, which reported no blocking from a
      // command that could not have been blocked.
      const queuedAlone: number[] = []
      for (let i = 0; i < 12; i++) {
        const start = performance.now()
        await client.getConversation(someConversation)
        queuedAlone.push(performance.now() - start)
      }
      queuedAlone.sort((a, b) => a - b)

      const queuedBehind: number[] = []
      for (let i = 0; i < 12; i++) {
        const big = client.getConversations()
        const start = performance.now()
        await client.getConversation(someConversation)
        queuedBehind.push(performance.now() - start)
        await big
      }
      queuedBehind.sort((a, b) => a - b)

      // The inline command behind the same big read, as a control.
      const inlineBehind: number[] = []
      for (let i = 0; i < 12; i++) {
        const big = client.getConversations()
        const start = performance.now()
        await client.getPref('bench')
        inlineBehind.push(performance.now() - start)
        await big
      }
      inlineBehind.sort((a, b) => a - b)

      const mid = (a: number[]) => a[Math.floor(a.length / 2)] as number
      const p95 = (a: number[]) => a[Math.floor(a.length * 0.95)] as number

      rows.push([
        String(target),
        ms(mid(times)),
        ms(p95(times)),
        ms(mid(queuedAlone)),
        ms(mid(queuedBehind)),
        ms(mid(queuedBehind) - mid(queuedAlone)),
        ms(mid(inlineBehind)),
      ])
      random = seeded(7 + target)
    }

    report(
      '\n\n== TIER 2: THE REAL ADDON ==  milliseconds, median unless stated\n\n' +
        table(rows, [
          'convos',
          'getAll',
          'getAll p95',
          'queued',
          'queued behind',
          'blocked by',
          'inline behind',
        ]) +
        '\n' +
        '  getAll         getConversations round trip: sqlite -> encode.cpp -> protobuf ->\n' +
        '                 thread-safe function -> JS decode -> facade\n' +
        '  queued         getConversation, alone. It goes through Client::_async, which is\n' +
        '                 loop.call, so it runs on the same single loop as the big read\n' +
        '  queued behind  the same command, issued while getConversations is still in flight\n' +
        '  blocked by     the difference: what a user-facing command waits for when a large\n' +
        '                 read is already running\n' +
        '  inline behind  getPref behind the same big read, as a control. The shim answers it\n' +
        '                 from core.globals without touching the loop, so it cannot be blocked -\n' +
        '                 which is why measuring it said nothing about blocking at all\n',
    )
  }, 600_000)
})

/** Local to this file: the fixtures generator is seeded per corpus, and this needs its own. */
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
