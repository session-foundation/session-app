import { create, toBinary, fromBinary } from '@bufbuild/protobuf'
import { MnemonicSchema } from '@session/proto'
import { it } from 'vitest'

import { makeCorpus } from './fixtures'
import { ms, report, table, time } from './measure'

/**
 * What interning account ids on a message page is worth, and where it stops paying.
 *
 * Measured against the payload as it stands rather than projected from it. This is the last of the
 * proposals that is still open: `Message.conversation_id` has left the wire, and the projection no
 * longer sorts, so both of the changes this file used to size are done.
 */

it('account ids: what interning is worth, and where it stops paying', () => {
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
    const authorBytes = messages.reduce((sum, m) => sum + m.author.length, 0)
    const scaffold = messages.length * 24
    const total = bodyBytes + authorBytes + scaffold

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
    const encodedTable = toBinary(
      MnemonicSchema,
      create(MnemonicSchema, { words: messages.map((m) => m.author) }),
    )
    const parseAuthors = time('parse authors', () => {
      fromBinary(MnemonicSchema, encodedTable)
    })

    rows.push([
      label,
      `${String(count)}/${String(authors)}`,
      (total / 1024).toFixed(1),
      (internedTotal / 1024).toFixed(1),
      `${((1 - internedTotal / total) * 100).toFixed(0)}%`,
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
        'interned KB',
        'intern saves',
        'parse authors',
        'rebuild',
      ]) +
      '\n' +
      '  interned KB    with authors replaced by a table and one index per message\n' +
      '  intern saves   what interning adds, on a page that no longer repeats a conversation id\n' +
      '  parse authors  protobuf-es allocating one string per message, as it does today\n' +
      '  rebuild        looking each index up in the table instead - the cost interning adds\n',
  )
})
