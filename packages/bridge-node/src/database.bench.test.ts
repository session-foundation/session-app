import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createNodeBridgeTransport } from './index'
import { createSessionClient, type ConversationId, type SessionClient } from '@session/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { accountId } from '@session/bench/fixtures'
import { ms, report, table } from '@session/bench/measure'

/**
 * What the database costs once there is something in it.
 *
 * The tier two numbers were taken against a database with a thousand conversations and *no
 * messages*, which flatters the conversation list badly: its snippet is a correlated subquery per
 * row -
 *
 *   coalesce((SELECT b.body FROM messages b
 *              WHERE b.conversation = c.id AND b.deleted IS NULL
 *              ORDER BY b.timestamp DESC, b.id DESC LIMIT 1), '')
 *
 * - and against an empty messages table it finds nothing and returns immediately. With messages
 * present it is an index seek plus a row fetch for every conversation in the list. That is the
 * term that grows, and it is the one worth knowing.
 */

const addon = join(import.meta.dirname, '../build/Release/session_bridge_node.node')
const describeAddon = existsSync(addon) ? describe : describe.skip

function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const mid = (a: number[]) => a[Math.floor(a.length / 2)] as number
const p95 = (a: number[]) => a[Math.floor(a.length * 0.95)] as number

async function timeAsync(run: () => Promise<unknown>, samples = 10): Promise<number[]> {
  for (let i = 0; i < 3; i++) await run()
  const times: number[] = []
  for (let i = 0; i < samples; i++) {
    const start = performance.now()
    await run()
    times.push(performance.now() - start)
  }
  return times.sort((a, b) => a - b)
}

describeAddon('the database, with something in it', () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'session-db-bench-'))
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  async function open(name: string): Promise<SessionClient> {
    const at = join(dir, name)
    await mkdir(join(at, 'cache'), { recursive: true })
    const client = createSessionClient(
      createNodeBridgeTransport({
        dbPath: join(at, 'session.db'),
        cacheDir: join(at, 'cache'),
        rawKey: new Uint8Array(32).fill(5),
        deferAccount: false,
      }),
    )
    await client.getAccountInfo()
    return client
  }

  it('the conversation list, as the message table fills up', async () => {
    const rows: string[][] = []

    // Two questions in one table, so the sizes have to serve both: the standard sweep at a fixed
    // message depth, plus three rows at 500 conversations that vary only the message volume.
    for (const [convos, perConvo] of [
      [100, 20],
      [500, 0],
      [500, 20],
      [500, 200],
      [1000, 20],
      [5000, 20],
    ] as const) {
      const client = await open(`c${String(convos)}m${String(perConvo)}`)
      const random = seeded(convos * 31 + perConvo)

      const ids: ConversationId[] = []
      const openStart = performance.now()
      for (let i = 0; i < convos; i++) ids.push(await client.openDm(accountId(random)))
      const openMs = performance.now() - openStart

      const sendStart = performance.now()
      for (const id of ids) {
        for (let m = 0; m < perConvo; m++) {
          await client.sendMessage(id, { body: `message ${String(m)} in this conversation` })
        }
      }
      const sendMs = performance.now() - sendStart
      const totalMessages = convos * perConvo

      const list = await timeAsync(() => client.getConversations())

      rows.push([
        `${String(convos)} x ${String(perConvo)}`,
        String(totalMessages),
        ms(openMs),
        totalMessages === 0 ? '-' : ms(sendMs),
        totalMessages === 0 ? '-' : (sendMs / totalMessages).toFixed(2),
        ms(mid(list)),
        ms(p95(list)),
      ])

      client.close()
    }

    // A regression guard, not decoration. The conversation list's snippet is a correlated
    // subquery per row, and it stays cheap only because messages_history covers its ORDER BY
    // exactly. Anything that breaks that - a column added to the ORDER BY, an index renamed, a
    // WHERE the index no longer serves - turns it into a scan per row, and the symptom is a
    // conversation list that got slow for reasons nothing points at.
    //
    // The bound is 3x rather than "flat" because it is not flat: at five hundred conversations,
    // going from ten thousand messages to a hundred thousand costs 0.82 ms to 1.85 ms. Sublinear,
    // and small in absolute terms, but real - an earlier version of this measured only forty
    // thousand messages and concluded there was no effect at all.
    const flat = rows.filter((r) => r[0]?.startsWith('500 x'))
    const withMessages = flat.map((r) => Number(r[5]))
    const worst = Math.max(...withMessages)
    const best = Math.min(...withMessages.filter((n) => n > 0))
    expect(
      worst / best,
      'listing 200 conversations must not get materially more expensive as messages pile up',
    ).toBeLessThan(3)

    report(
      '\n\n== THE CONVERSATION LIST vs MESSAGE VOLUME ==  milliseconds\n\n' +
        table(rows, [
          'convos x msgs',
          'messages',
          'openDm all',
          'send all',
          'per send',
          'getConvos',
          'p95',
        ]) +
        '\n' +
        '  The row with 0 messages is the tier two measurement, and it is the misleading one:\n' +
        '  the snippet subquery finds nothing and returns at once. Compare it against 1 message\n' +
        '  per conversation - that difference is the per-row seek and fetch, and it is paid\n' +
        '  whether a conversation has one message or a thousand.\n',
    )
  }, 900_000)

  it('paging a long transcript', async () => {
    const client = await open('transcript')
    const random = seeded(99)
    const id = await client.openDm(accountId(random))

    const rows: string[][] = []
    let written = 0

    // Capped below SQLITE_MAX_VARIABLE_NUMBER: `all at once` asks for the whole transcript,
    // and libsession's attachment query binds one variable per message. See limit.test.ts.
    for (const depth of [100, 1000, 5000, 10000, 20000, 32000]) {
      while (written < depth) {
        await client.sendMessage(id, { body: `message number ${String(written)}` })
        written++
      }

      // The first page: newest, no cursor. What opening a conversation costs.
      const first = await timeAsync(() => client.getMessages(id, { limit: 30 }))

      // The oldest page, reached by cursor. What scrolling to the top costs, per page.
      const page = await client.getMessages(id, { limit: 30 })
      const oldest = page[0]
      const deep = oldest
        ? await timeAsync(() =>
            client.getMessages(id, {
              limit: 30,
              before: { timestamp: oldest.timestamp, id: oldest.id },
            }),
          )
        : [0]

      // The whole thing at once, which is what a naive "load everything" would do.
      const all = await timeAsync(() => client.getMessages(id, { limit: depth }), 5)

      rows.push([
        String(depth),
        ms(mid(first)),
        ms(p95(first)),
        ms(mid(deep)),
        ms(mid(all)),
        ms((mid(all) / depth) * 1000),
      ])
    }

    report(
      '\n\n== PAGING A TRANSCRIPT ==  milliseconds\n\n' +
        table(rows, ['messages', 'first 30', 'p95', 'next 30', 'all at once', 'us/msg']) +
        '\n' +
        '  first 30      opening a conversation: newest page, no cursor\n' +
        '  next 30       one page older, by (timestamp, id) cursor\n' +
        '  all at once   what asking for the whole transcript costs, for scale\n' +
        '  A flat "first 30" column means messages_history is doing its job and depth is free.\n',
    )

    client.close()
  }, 900_000)
})
