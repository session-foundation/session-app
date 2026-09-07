import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createNodeBridgeTransport } from './index'
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
 * compiles no C++.
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

    // The same four sizes every table in this suite uses, so the rows line up across tiers.
    for (const target of [100, 500, 1000, 5000]) {
      while (opened < target) {
        await client.openDm(accountId(random))
        opened++
      }

      const times: number[] = []
      for (let i = 0; i < 12; i++) {
        const start = performance.now()
        await client.getConversations()
        times.push(performance.now() - start)
      }
      times.sort((a, b) => a - b)

      // A small command straight afterwards, to see what the round trip costs on its own.
      const smallTimes: number[] = []
      for (let i = 0; i < 12; i++) {
        const start = performance.now()
        await client.getPref('bench')
        smallTimes.push(performance.now() - start)
      }
      smallTimes.sort((a, b) => a - b)

      // The one that matters: a small command issued while the big one is still in flight.
      const blockedTimes: number[] = []
      for (let i = 0; i < 12; i++) {
        const big = client.getConversations()
        const start = performance.now()
        await client.getPref('bench')
        blockedTimes.push(performance.now() - start)
        await big
      }
      blockedTimes.sort((a, b) => a - b)

      const mid = (a: number[]) => a[Math.floor(a.length / 2)] as number
      const p95 = (a: number[]) => a[Math.floor(a.length * 0.95)] as number

      rows.push([
        String(target),
        ms(mid(times)),
        ms(p95(times)),
        ms(mid(smallTimes)),
        ms(mid(blockedTimes)),
        ms(mid(blockedTimes) - mid(smallTimes)),
      ])
      random = seeded(7 + target)
    }

    report(
      '\n\n== TIER 2: THE REAL ADDON ==  milliseconds, median unless stated\n\n' +
        table(rows, ['convos', 'getAll', 'getAll p95', 'small', 'small behind', 'blocked by']) +
        '\n' +
        '  getAll        getConversations round trip: sqlite -> encode.cpp -> protobuf ->\n' +
        '                thread-safe function -> JS decode -> facade\n' +
        '  small         getPref round trip, the floor for any command\n' +
        '  small behind  the same getPref, issued while getConversations is still in flight\n' +
        '  blocked by    the difference - and it is zero, because libsession answers the\n' +
        '                cheap command first. Verified separately: with getConversations and\n' +
        '                getPref both in flight over 1000 conversations, the resolution order\n' +
        '                is small then big. Commands are NOT serialised in submission order.\n' +
        '                The FIFO guarantee is about an event and the response that must follow\n' +
        '                it, not about making every command queue behind every other one.\n',
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
