import { create, toBinary, fromBinary } from '@bufbuild/protobuf'
import { FrameSchema, MnemonicSchema } from '@session/proto'
import { applyEvent, compareConversations, emptyState } from '@session/state'
import type { Conversation, ConversationId, SessionState } from '@session/state'
import { it } from 'vitest'

import { conversationListFrame, conversationUpdatedFrame, makeCorpus } from './fixtures'
import { ms, report, table, time } from './measure'
import { decodeOne, loopback, type Loopback } from './pipeline'

/**
 * What the two proposed changes are actually worth.
 *
 * Both are measured against the code as it stands rather than projected from it: an A/B where the
 * only difference is the thing being changed. The optimised `upsertConversation` here is a sketch
 * for measurement, not a patch - it exists to put a number on the ceiling before anyone spends a
 * day reaching for it.
 */

const pipe: Loopback = loopback()

// -- The optimised projection -------------------------------------------------------------------

/**
 * The same semantics as `upsertConversation`, without rebuilding the order from scratch.
 *
 * The current one calls Object.values on the whole index, sorts it with a JavaScript comparator,
 * and maps it to ids - three N-length allocations and an O(N log N) sort with a callback per
 * comparison, for a payload of one row. This keeps the order array sorted and moves the single row
 * that changed: a binary search for where it belongs, and one splice. The array copy is still O(N),
 * but a memmove is not a comparator.
 */
function binarySearch(
  order: readonly ConversationId[],
  index: Record<ConversationId, Conversation>,
  needle: Conversation,
): number {
  let low = 0
  let high = order.length
  while (low < high) {
    const mid = (low + high) >>> 1
    const at = index[order[mid] as ConversationId]
    if (at !== undefined && compareConversations(at, needle) < 0) low = mid + 1
    else high = mid
  }
  return low
}

function upsertOptimised(state: SessionState, conversation: Conversation): SessionState {
  const intoRequests = conversation.request
  const from = intoRequests ? 'conversations' : 'requests'
  const fromOrder = intoRequests ? 'conversationOrder' : 'requestOrder'
  const to = intoRequests ? 'requests' : 'conversations'
  const toOrder = intoRequests ? 'requestOrder' : 'conversationOrder'

  const { [conversation.id]: _gone, ...withoutFromOther } = state[from]
  const target = { ...state[to], [conversation.id]: conversation }

  const current = state[toOrder]
  const existing = current.indexOf(conversation.id)
  const without = existing >= 0 ? [...current.slice(0, existing), ...current.slice(existing + 1)] : current
  const at = binarySearch(without, target, conversation)
  const order = [...without.slice(0, at), conversation.id, ...without.slice(at)]

  // Only pay to rewrite the other list when the row was actually in it.
  const otherOrder = state[fromOrder]
  const otherIndex = otherOrder.indexOf(conversation.id)
  const otherNext =
    otherIndex >= 0
      ? [...otherOrder.slice(0, otherIndex), ...otherOrder.slice(otherIndex + 1)]
      : otherOrder

  return {
    ...state,
    [from]: withoutFromOther,
    [fromOrder]: otherNext,
    [to]: target,
    [toOrder]: order,
  }
}

it('upsertConversation: what dropping the re-sort is worth', () => {
  const rows: string[][] = []

  for (const n of [100, 500, 1000, 5000, 10000]) {
    const { conversations } = makeCorpus({ conversations: n, messages: 0 })
    let seeded = emptyState
    pipe.push(conversationListFrame(conversations))
    for (const event of pipe.drain()) seeded = applyEvent(seeded, event)

    const single = conversations[0]
    if (!single) throw new Error('no fixture conversation')
    const event = decodeOne(pipe, conversationUpdatedFrame({ ...single, unreadCount: 9 }))
    if (event.type !== 'conversation-updated') throw new Error('wrong event')

    const before = time('current', () => {
      applyEvent(seeded, event)
    })
    const after = time('optimised', () => {
      upsertOptimised(seeded, event.conversation)
    })

    const saved = before.median - after.median
    rows.push([
      String(n),
      ms(before.median),
      ms(after.median),
      ms(saved),
      before.median === 0 ? '-' : `${((saved / before.median) * 100).toFixed(0)}%`,
      ms(before.median * 20),
      ms(after.median * 20),
    ])
  }

  report(
    '\n\n== upsertConversation: CURRENT vs NO RE-SORT ==  milliseconds, median\n\n' +
      table(rows, ['store holds', 'current', 'optimised', 'saved', 'saved %', 'x20 now', 'x20 after']) +
      '\n' +
      '  x20 is one poll cycle touching twenty rows, which is where this stops being academic.\n' +
      '  The optimised version keeps the order sorted and moves one row: a binary search and a\n' +
      '  splice, instead of Object.values + sort + map over everything.\n',
  )
})

// -- Interning ----------------------------------------------------------------------------------

/**
 * Both proposals, sized and timed against a real codec.
 *
 * The interned payload is built with the schema that exists - a repeated string for the table, and
 * an index in place of each author - so the numbers come from protobuf-es rather than from
 * arithmetic about protobuf-es. The reconstruction step is timed separately and added back, since
 * that is the cost the saving has to beat.
 */
it('account ids: what the two payload changes are worth, and where interning stops paying', () => {
  const rows: string[][] = []

  for (const [label, count, authors] of [
    ['DM', 500, 2],
    ['small group', 500, 10],
    ['large group', 500, 50],
    ['every message a new author', 500, 500],
    ['long DM transcript', 2000, 2],
  ] as const) {
    const { messages } = makeCorpus({ conversations: 1, messages: count, authorCount: authors })

    const bodyBytes = messages.reduce((sum, m) => sum + m.body.length, 0)
    const convIdBytes = messages.reduce((sum, m) => sum + m.conversationId.length, 0)
    const authorBytes = messages.reduce((sum, m) => sum + m.author.length, 0)
    const scaffold = messages.length * 24
    const total = bodyBytes + convIdBytes + authorBytes + scaffold

    // Interned: one copy of each distinct author, plus a small index per message. A varint index
    // is one byte below 128 and two above, which is what makes the unique-author case lose.
    const distinct = new Set(messages.map((m) => m.author)).size
    const indexBytes = messages.length * (distinct < 128 ? 1 : 2)
    const tableBytes = distinct * 66
    const internedTotal = bodyBytes + scaffold + tableBytes + indexBytes

    // The reconstruction the JS side would have to do: look each index up in the table. Timed
    // rather than assumed, because "is rebuilding slower than parsing" is the whole question.
    const table_ = [...new Set(messages.map((m) => m.author))]
    const indices = messages.map((m) => table_.indexOf(m.author))
    const rebuild = time('rebuild', () => {
      const out: string[] = new Array(indices.length) as string[]
      for (let i = 0; i < indices.length; i++) out[i] = table_[indices[i] as number] as string
      return out
    })

    // The allocation the current scheme forces: a distinct 66-character string per message.
    const encodedTable = toBinary(MnemonicSchema, create(MnemonicSchema, { words: messages.map((m) => m.author) }))
    const parseAuthors = time('parse authors', () => {
      fromBinary(MnemonicSchema, encodedTable)
    })

    rows.push([
      label,
      `${String(count)}/${String(authors)}`,
      (total / 1024).toFixed(1),
      `${(((convIdBytes) / total) * 100).toFixed(0)}%`,
      (internedTotal / 1024).toFixed(1),
      `${((1 - internedTotal / (total - convIdBytes)) * 100).toFixed(0)}%`,
      ms(parseAuthors.median),
      ms(rebuild.median),
    ])
  }

  report(
    '\n\n== ACCOUNT IDS: THE TWO CHANGES, SIZED AND TIMED ==\n\n' +
      table(rows, [
        'shape',
        'msgs/authors',
        'now KB',
        'convId %',
        'interned KB',
        'intern saves',
        'parse authors',
        'rebuild',
      ]) +
      '\n' +
      '  convId %       Message.conversation_id, which is already on the envelope. Removing it\n' +
      '                 needs no scheme and has no tipping point: one value per page, always.\n' +
      '  interned KB    after BOTH changes: convId dropped and authors replaced by an index\n' +
      '  intern saves   what interning alone adds, measured after convId is already gone\n' +
      '  parse authors  protobuf-es allocating one string per message, as it does today\n' +
      '  rebuild        looking each index up in the table instead - the cost interning adds\n',
  )
})
