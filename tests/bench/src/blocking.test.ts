import { create, toBinary } from '@bufbuild/protobuf'
import { FrameSchema, ResponseSchema } from '@session/proto'
import { applyEvent, emptyState } from '@session/state'
import { afterAll, it } from 'vitest'

import { conversationListFrame, conversationUpdatedFrame, makeCorpus } from './fixtures'
import { ms, report, table } from './measure'
import { loopback, type Loopback } from './pipeline'

/**
 * How long a button's answer waits behind somebody else's payload.
 *
 * This is the question the whole exercise exists for, and it is a latency measurement rather
 * than a throughput one. Responses and events share one FIFO stream by design - see
 * frames.proto - so an event queued ahead of a response is decoded before it, on the one
 * thread, with no preemption. The number below is how much that costs.
 *
 * Deliberately not measuring the transport: this runs the facade's own sink, which is where the
 * decode happens, so the figure is the JavaScript half alone. The C++ encode and the thread hop
 * are tier two.
 */

const pipe: Loopback = loopback()
afterAll(() => {
  pipe.close()
})

/** A Response frame the size a small command's answer really is. */
function smallResponse(id: number): Uint8Array {
  return toBinary(
    FrameSchema,
    create(FrameSchema, {
      kind: {
        case: 'response',
        value: create(ResponseSchema, {
          requestId: id,
          result: { case: 'empty', value: {} },
        }),
      },
    }),
  )
}

it('a small response arriving behind a conversation list', () => {
  const rows: string[][] = []
  const response = smallResponse(1)

  for (const n of [0, 100, 500, 1000, 5000]) {
    const frames: Uint8Array[] = []
    if (n > 0) {
      const { conversations } = makeCorpus({ conversations: n, messages: 0 })
      frames.push(conversationListFrame(conversations))
    }
    frames.push(response)

    // Everything a real sink does, including the projection each event triggers, because the
    // response cannot be reached until the work in front of it has finished.
    const waits: number[] = []
    for (let sample = 0; sample < 30; sample++) {
      let state = emptyState
      const queuedAt = performance.now()
      for (const frame of frames) {
        pipe.push(frame)
        for (const event of pipe.drain()) state = applyEvent(state, event)
      }
      waits.push(performance.now() - queuedAt)
      if (state === emptyState && n > 0) throw new Error('the list never landed')
    }
    waits.sort((a, b) => a - b)

    rows.push([
      n === 0 ? 'nothing' : String(n),
      ms(waits[Math.floor(waits.length / 2)] as number),
      ms(waits[Math.floor(waits.length * 0.95)] as number),
      ms(waits[waits.length - 1] as number),
      waits[Math.floor(waits.length / 2)]! > 16.7 ? 'DROPS A FRAME' : 'ok',
    ])
  }

  report(
    '\n\n== HEAD-OF-LINE BLOCKING ==  how long a small response waits behind an event\n\n' +
      table(rows, ['in front', 'median', 'p95', 'max', 'at 60Hz']) +
      '\n' +
      '  The first row is the floor: a response with nothing ahead of it.\n' +
      '  Every other row is that floor plus the decode and projection of the event\n' +
      '  queued in front, because one FIFO stream is what guarantees the ordering.\n',
  )
})

it('a storm of single-conversation updates, as polling produces', () => {
  const rows: string[][] = []

  for (const listSize of [100, 500, 1000, 5000]) {
    const { conversations } = makeCorpus({ conversations: listSize, messages: 0 })

    // Seed the store, then update one row at a time - what a poll cycle looks like when unread
    // counts move.
    let seeded = emptyState
    pipe.push(conversationListFrame(conversations))
    for (const event of pipe.drain()) seeded = applyEvent(seeded, event)

    const single = conversations[0]
    if (!single) throw new Error('no fixture conversation')
    // conversation_updated, not a one-row list_replaced: only the former reaches
    // upsertConversation, which is the function that re-sorts everything.
    const updateFrame = conversationUpdatedFrame({ ...single, unreadCount: 9 })

    pipe.push(updateFrame)
    const [listEvent] = pipe.drain()
    if (!listEvent) throw new Error('no event')

    const times: number[] = []
    for (let i = 0; i < 40; i++) {
      const start = performance.now()
      applyEvent(seeded, listEvent)
      times.push(performance.now() - start)
    }
    times.sort((a, b) => a - b)

    rows.push([
      String(listSize),
      ms(times[Math.floor(times.length / 2)] as number),
      ms(times[Math.floor(times.length * 0.95)] as number),
      ms((times[Math.floor(times.length / 2)] as number) * 20),
    ])
  }

  report(
    '\n\n== ONE ROW CHANGES ==  applyEvent cost when the store already holds N conversations\n\n' +
      table(rows, ['store holds', 'median', 'p95', 'x20 events']) +
      '\n' +
      '  upsertConversation re-sorts the entire list and rebuilds the order array for\n' +
      '  every single row that changes. The payload is one conversation; the work is N.\n' +
      '  The last column is one poll cycle that touches twenty rows.\n',
  )
})
