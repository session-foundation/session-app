import { fromBinary } from '@bufbuild/protobuf'
import { FrameSchema } from '@session/proto'
import { applyEvent, emptyState, type SessionState } from '@session/state'
import { afterAll, it } from 'vitest'

import { conversationListFrame, makeCorpus, messageAddedFrame } from './fixtures'
import { ms, report, table, time } from './measure'
import { decodeOne, loopback, type Loopback } from './pipeline'

/**
 * Where the JavaScript thread's time goes, stage by stage.
 *
 * Tier one of the benchmark plan: no bridge, no device, no Electron. It exists to answer one
 * question before anyone changes the bridge - is the serialisation the expensive part, or is
 * everything downstream of it? Printed rather than asserted, because the only numbers worth
 * holding a build to are ones taken on the slowest device that ships, and this runs on whatever
 * the developer happens to have.
 */

const pipe: Loopback = loopback()
afterAll(() => {
  pipe.close()
})

it('conversation list: where the time goes', () => {
  const rows: string[][] = []

  for (const n of [1, 10, 100, 500, 1000, 5000]) {
    const { conversations } = makeCorpus({ conversations: n, messages: 0 })
    const bytes = conversationListFrame(conversations)

    // Stage 1 alone. Stage 2 is only measurable as (facade - parse), because decodeEvent and
    // the convert.ts remap are private to the facade and running a copy of them would be
    // measuring the copy.
    const parse = time('parse', () => {
      fromBinary(FrameSchema, bytes)
    })
    const facade = time('facade', () => {
      pipe.push(bytes)
      pipe.drain()
    })
    const remap = Math.max(facade.median - parse.median, 0)

    const event = decodeOne(pipe, bytes)
    const project = time('project', () => {
      applyEvent(emptyState, event)
    })

    // What every store notification costs before React starts: useConversations rebuilds the
    // visible array from the order array and the index on each notification.
    const projected = applyEvent(emptyState, event)
    const select = time('select', () => {
      projected.conversationOrder
        .map((id) => projected.conversations[id])
        .filter((c) => c !== undefined)
    })

    const total = facade.median + project.median + select.median

    rows.push([
      String(n),
      (bytes.length / 1024).toFixed(1),
      ms(parse.median),
      ms(remap),
      ms(project.median),
      ms(select.median),
      ms(total),
      ms(facade.p95 + project.p95 + select.p95),
      total === 0 ? '-' : `${((facade.median / total) * 100).toFixed(0)}%`,
    ])
  }

  report(
    '\n\n== CONVERSATION LIST ==  one conversation_list_replaced, milliseconds, median\n\n' +
      table(rows, ['rows', 'KB', 'parse', 'remap', 'project', 'select', 'TOTAL', 'p95', 'ser%']) +
      '\n' +
      '  parse    fromBinary - protobuf-es decode\n' +
      '  remap    decodeEvent + convert.ts, measured as (facade - parse)\n' +
      '  project  applyEvent - builds a new index, sorts the whole list, new order array\n' +
      '  select   what useConversations() rebuilds on every single store notification\n' +
      '  ser%     the share direct JSI structs could remove. Everything else stays.\n',
  )
})

it('one new message arriving in a transcript that is already loaded', () => {
  const rows: string[][] = []

  for (const n of [50, 200, 1000, 3000, 10000]) {
    const { conversations, messages } = makeCorpus({ conversations: 1, messages: n })
    const conversationId = conversations[0]?.id as string

    const state: SessionState = {
      ...emptyState,
      histories: {
        [conversationId]: {
          ready: true,
          messages: messages.map((m) => ({
            id: Number(m.id),
            conversationId: m.conversationId,
            author: m.author,
            timestamp: Number(m.timestamp),
            body: m.body,
            outgoing: m.outgoing,
            sendState: 'sent' as const,
            attachments: [],
          })),
          exhausted: true,
          fetching: false,
        },
      },
    }

    const last = messages[messages.length - 1]
    if (!last) throw new Error('no fixture message')
    const bytes = messageAddedFrame(conversationId, {
      ...last,
      id: BigInt(n + 1),
      timestamp: BigInt(Number(last.timestamp) + 1000),
    })

    const facade = time('facade', () => {
      pipe.push(bytes)
      pipe.drain()
    })
    const event = decodeOne(pipe, bytes)
    const project = time('project', () => {
      applyEvent(state, event)
    })

    rows.push([
      String(n),
      (bytes.length / 1024).toFixed(2),
      ms(facade.median),
      ms(project.median),
      ms(project.p95),
      ms(facade.median + project.median),
    ])
  }

  report(
    '\n\n== ONE NEW MESSAGE ==  the payload is a single message however long the transcript is\n\n' +
      table(rows, ['loaded', 'KB', 'decode', 'project', 'proj p95', 'TOTAL']) +
      '\n' +
      '  The payload does not grow with the transcript. If `project` does, the cost is in\n' +
      '  applyEvent and nothing about the bridge or the wire format can reach it.\n',
  )
})

it('account ids: what they cost on the wire', () => {
  const rows: string[][] = []

  for (const [label, authors] of [
    ['DM (2 authors)', 2],
    ['small group (10)', 10],
    ['large group (100)', 100],
  ] as const) {
    const n = 500
    const { messages } = makeCorpus({ conversations: 1, messages: n, authorCount: authors })

    const idBytes = messages.reduce((sum, m) => sum + m.author.length + m.conversationId.length, 0)
    const total = messages.reduce(
      (sum, m) => sum + m.author.length + m.conversationId.length + m.body.length + 24,
      0,
    )
    const unique = new Set(messages.map((m) => m.author)).size

    rows.push([
      label,
      String(n),
      String(unique),
      (idBytes / 1024).toFixed(1),
      (total / 1024).toFixed(1),
      `${((idBytes / total) * 100).toFixed(0)}%`,
      // conversation_id is identical for every message in the page and is also on the envelope.
      (messages.reduce((s, m) => s + m.conversationId.length, 0) / 1024).toFixed(1),
    ])
  }

  report(
    '\n\n== ACCOUNT IDS ==  500 messages, bytes spent on identity\n\n' +
      table(rows, ['shape', 'msgs', 'uniq', 'id KB', 'total KB', 'id %', 'dup convId KB']) +
      '\n' +
      '  id %            share of a message page that is account ids, as hex strings\n' +
      '  dup convId KB   Message.conversation_id, repeated per message, and already on the\n' +
      '                  envelope - free to remove, no interning scheme required\n',
  )
})
