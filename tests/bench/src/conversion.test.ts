import { fromBinary } from '@bufbuild/protobuf'
import { FrameSchema } from '@session/proto'
import { describe, expect, it } from 'vitest'

import { conversationListFrame, makeCorpus, messageAddedFrame } from './fixtures'
import { ms, report, table, time } from './measure'
import { loopback } from './pipeline'

/**
 * What the protobuf parse costs, and what the conversion to domain types costs, separately.
 *
 * The report has been quoting one number for both: 32 µs per row for "the JavaScript decode".
 * That conflates two steps with different fates. `fromBinary` disappears entirely if the shim
 * hands over structs, because there is no wire to parse. `fromConversationPb` might not: some
 * representation still has to exist for the store and the UI, and if it has to be built either
 * way then it is not a saving, it is a cost that follows the data into any design.
 *
 * Neither step is separately callable - `convert.ts` is private to the facade, and the existing
 * pipeline refuses to re-implement it on the grounds that a copy measures the copy. So the split
 * is taken differentially: `fromBinary` on its own against the whole facade path, with the
 * difference attributed to conversion, dispatch and the listener broadcast together.
 *
 * Read the slope, not the totals. Both steps are linear in rows, so the per-row cost is the
 * gradient between the smallest and largest size, and every fixed cost - allocating the frame,
 * the oneof switch, calling the listener - cancels out of a subtraction between two sizes.
 */

/** A list row renders four of the fifteen fields. Reading only those is what a lazy accessor does. */
function readRenderedFields(
  conversations: readonly {
    displayName: string
    snippet?: string
    unreadCount: number
    lastActivity: number
  }[],
): number {
  let sink = 0
  for (const c of conversations) {
    sink += c.displayName.length + (c.snippet?.length ?? 0) + c.unreadCount + c.lastActivity
  }
  return sink
}

const SIZES = [12, 50, 100, 500, 1000, 5000] as const

function samplesFor(rows: number): number {
  return rows >= 5000 ? 12 : rows >= 1000 ? 25 : 40
}

describe('what the conversion costs, separately from the parse', () => {
  it('splits the conversation-list decode into parse and convert', () => {
    const pipe = loopback()
    const rows: string[][] = []
    const perRow: { n: number; parse: number; whole: number }[] = []

    try {
      for (const n of SIZES) {
        const { conversations } = makeCorpus({ conversations: n, messages: 0 })
        const bytes = conversationListFrame(conversations)
        const samples = samplesFor(n)

        const parse = time(
          `parse ${n}`,
          () => {
            fromBinary(FrameSchema, bytes)
          },
          { samples },
        )

        const whole = time(
          `whole ${n}`,
          () => {
            pipe.push(bytes)
            pipe.drain()
          },
          { samples },
        )

        const convert = whole.median - parse.median
        perRow.push({ n, parse: parse.median, whole: whole.median })

        rows.push([
          String(n),
          ms(parse.median),
          ms(convert),
          ms(whole.median),
          `${((parse.median / whole.median) * 100).toFixed(0)}%`,
          ms((parse.median / n) * 1000),
          ms((convert / n) * 1000),
        ])
      }
    } finally {
      pipe.close()
    }

    const first = perRow[0]!
    const last = perRow[perRow.length - 1]!
    const span = last.n - first.n
    const parseSlope = ((last.parse - first.parse) / span) * 1000
    const wholeSlope = ((last.whole - first.whole) / span) * 1000
    const convertSlope = wholeSlope - parseSlope

    report(
      `\n\nCONVERSATION LIST: parse vs convert\n\n` +
        table(rows, ['rows', 'parse', 'convert', 'whole', 'parse%', 'µs/row', 'µs/row']) +
        `\n\nper-row by slope (${first.n} → ${last.n} rows, fixed costs cancelled)\n` +
        `  parse    ${ms(parseSlope)} µs/row\n` +
        `  convert  ${ms(convertSlope)} µs/row\n` +
        `  whole    ${ms(wholeSlope)} µs/row\n` +
        `  parse is ${((parseSlope / wholeSlope) * 100).toFixed(0)}% of the per-row cost\n`,
    )

    // The parse cannot be free, and it cannot be the whole cost either: if either of these
    // trips, the differential method has broken rather than the code getting faster.
    expect(parseSlope).toBeGreaterThan(0)
    expect(convertSlope).toBeGreaterThan(0)
  })

  it('splits the message-page decode into parse and convert', () => {
    const pipe = loopback()
    const rows: string[][] = []
    const perRow: { n: number; parse: number; whole: number }[] = []

    try {
      for (const n of SIZES) {
        const { messages } = makeCorpus({ conversations: 1, messages: n })
        // One frame per message is what messageAdded does; a page arrives as a MessageList
        // response instead, but the per-row work is the same conversion either way.
        const frames = messages.map((m) => messageAddedFrame('05'.padEnd(66, 'a'), m))
        const samples = samplesFor(n)

        const parse = time(
          `parse ${n}`,
          () => {
            for (const f of frames) fromBinary(FrameSchema, f)
          },
          { samples },
        )

        const whole = time(
          `whole ${n}`,
          () => {
            for (const f of frames) pipe.push(f)
            pipe.drain()
          },
          { samples },
        )

        const convert = whole.median - parse.median
        perRow.push({ n, parse: parse.median, whole: whole.median })

        rows.push([
          String(n),
          ms(parse.median),
          ms(convert),
          ms(whole.median),
          `${((parse.median / whole.median) * 100).toFixed(0)}%`,
          ms((parse.median / n) * 1000),
          ms((convert / n) * 1000),
        ])
      }
    } finally {
      pipe.close()
    }

    const first = perRow[0]!
    const last = perRow[perRow.length - 1]!
    const span = last.n - first.n
    const parseSlope = ((last.parse - first.parse) / span) * 1000
    const wholeSlope = ((last.whole - first.whole) / span) * 1000

    report(
      `\n\nMESSAGES: parse vs convert\n\n` +
        table(rows, ['rows', 'parse', 'convert', 'whole', 'parse%', 'µs/row', 'µs/row']) +
        `\n\nper-row by slope (${first.n} → ${last.n} rows)\n` +
        `  parse    ${ms(parseSlope)} µs/row\n` +
        `  convert  ${ms(wholeSlope - parseSlope)} µs/row\n` +
        `  whole    ${ms(wholeSlope)} µs/row\n` +
        `  parse is ${((parseSlope / wholeSlope) * 100).toFixed(0)}% of the per-row cost\n`,
    )

    expect(parseSlope).toBeGreaterThan(0)
  })

  /**
   * Eager against lazy, which is the choice between the two ways to hand structs over.
   *
   * A Nitro struct is marshalled into a real JavaScript object as it crosses, so every row
   * fetched is built whether or not anything reads it. A jsi::HostObject is a view: the object
   * is cheap and each property read crosses into C++, so you pay for the rows the UI touches
   * and no others. Twelve rows are on screen out of five thousand fetched, so the gap between
   * those two is the whole question.
   *
   * What is measurable here is the JavaScript side of it: building N domain objects against
   * reading the four fields a row renders. The per-access cost of a real HostObject getter is
   * NOT measured - that needs C++ and a device build - so the lazy column below is a floor,
   * and the true number is that plus one JSI crossing per property read.
   */
  it('shows what is paid for rows nobody looks at', () => {
    const pipe = loopback()
    const rows: string[][] = []

    try {
      for (const n of [100, 500, 1000, 5000] as const) {
        const { conversations } = makeCorpus({ conversations: n, messages: 0 })
        const bytes = conversationListFrame(conversations)
        const samples = samplesFor(n)

        pipe.drain()
        pipe.push(bytes)
        const event = pipe.drain()[0]
        if (!event || event.type !== 'conversation-list-replaced') {
          throw new Error(`expected a list event, got ${event?.type ?? 'nothing'}`)
        }
        const domain = event.conversations
        const window = domain.slice(0, 12)

        const eager = time(
          `eager ${n}`,
          () => {
            pipe.push(bytes)
            pipe.drain()
          },
          { samples },
        )

        const readAll = time(
          `read all ${n}`,
          () => {
            readRenderedFields(domain)
          },
          { samples },
        )

        const readWindow = time(
          `read window ${n}`,
          () => {
            readRenderedFields(window)
          },
          { samples },
        )

        rows.push([
          String(n),
          ms(eager.median),
          ms(readAll.median),
          ms(readWindow.median),
          `${(eager.median / Math.max(readWindow.median, 0.0001)).toFixed(0)}×`,
        ])
      }
    } finally {
      pipe.close()
    }

    report(
      `\n\nACCESS PATTERN: what a lazy accessor would avoid (JavaScript side only)\n\n` +
        table(rows, ['rows', 'parse+convert all', 'read all', 'read 12', 'ratio']) +
        `\n  "read" is the four fields a list row draws, over rows already in memory.\n` +
        `  A real HostObject adds one JSI crossing per property read, which is not measured here.\n`,
    )

    expect(rows.length).toBe(4)
  })
})
