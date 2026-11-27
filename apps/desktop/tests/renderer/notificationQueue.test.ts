import type { IncomingNotification } from '@session/client'
import { tr } from '@session/localization'
import { describe, expect, it } from 'vitest'

import {
  createNotificationQueue,
  HOLD_AFTER_CONNECT_MS,
  REBUILD_EVERY_MS,
  type NotificationSummary,
} from '#src/renderer/notificationQueue'
import { notificationSummary } from '#src/renderer/notificationText'

const ALICE = '05' + 'a'.repeat(64)
const BOB = '05' + 'b'.repeat(64)

/** A message notification from Alice, with what the content setting hides left out. */
function message(
  id: string,
  fields: Partial<IncomingNotification> = {},
  hidden: readonly ('body' | 'sender')[] = [],
): IncomingNotification {
  const shown: IncomingNotification = {
    id,
    kind: 'message',
    conversationId: ALICE,
    messageId: Number(id.replace(/\D/g, '')) || 1,
    sender: 'Alice',
    body: `says ${id}`,
    attachments: 0,
    timestamp: 1,
    ...fields,
  }
  for (const field of hidden) Reflect.deleteProperty(shown, field)
  return shown
}

/** A queue on a clock the test moves by hand. */
function harness() {
  let nowMs = 0
  let timers: { atMs: number; run: () => void }[] = []
  const shown: (NotificationSummary | null)[] = []
  const queue = createNotificationQueue({
    show: (summary) => shown.push(summary),
    nowMs: () => nowMs,
    schedule: (run, ms) => {
      const timer = { atMs: nowMs + ms, run }
      timers.push(timer)
      return () => {
        timers = timers.filter((t) => t !== timer)
      }
    },
  })
  const advance = (ms: number) => {
    nowMs += ms
    for (;;) {
      const due = timers.find((t) => t.atMs <= nowMs)
      if (due === undefined) return
      timers = timers.filter((t) => t !== due)
      due.run()
    }
  }
  return { queue, shown, advance }
}

describe('the one desktop notification, as legacy desktop words it', () => {
  it('names the sender and says the message for one', () => {
    expect(notificationSummary([message('m1')])).toEqual({ title: 'Alice', body: 'says m1' })
  })

  it('counts several and says who sent the newest, and what', () => {
    const two = [message('m1'), message('m2', { conversationId: BOB, sender: 'Bob' })]
    expect(notificationSummary(two)).toEqual({
      title: tr('messageNew', { count: 2 }),
      body: `${tr('notificationsMostRecent', { name: 'Bob' })}: says m2`,
    })
  })

  it('says only who, for the name only setting', () => {
    const nameOnly = (id: string) => message(id, {}, ['body'])
    expect(notificationSummary([nameOnly('m1')])).toEqual({
      title: tr('messageNew', { count: 1 }),
      body: `${tr('from')} Alice`,
    })
    expect(notificationSummary([nameOnly('m1'), nameOnly('m2')])).toEqual({
      title: tr('messageNew', { count: 2 }),
      body: tr('notificationsMostRecent', { name: 'Alice' }),
    })
  })

  it('counts alone when the setting hides the sender too, and for a request', () => {
    const hidden = (id: string) => message(id, {}, ['body', 'sender'])
    expect(notificationSummary([hidden('m1'), hidden('m2')])).toEqual({
      title: tr('appName'),
      body: tr('messageNew', { count: 2 }),
    })
    const request: IncomingNotification = {
      id: 'r1',
      kind: 'request',
      attachments: 0,
      timestamp: 1,
    }
    expect(notificationSummary([request])).toEqual({
      title: tr('appName'),
      body: tr('messageRequestsNew'),
    })
  })
})

describe('the queue behind it', () => {
  it('shows one notification for a run of messages, two seconds after the first', () => {
    const { queue, shown, advance } = harness()
    queue.add(message('m1'), { audio: false })
    advance(1_000)
    queue.add(message('m2'), { audio: true })
    expect(shown).toEqual([])
    advance(REBUILD_EVERY_MS - 1_000)
    expect(shown).toHaveLength(1)
    expect(shown[0]?.title).toBe(tr('messageNew', { count: 2 }))
    // The newest says where a click leads, and whether it sounds.
    expect(shown[0]?.tap).toEqual({ kind: 'conversation', conversationId: ALICE, messageId: 2 })
    expect(shown[0]?.silent).toBe(false)
  })

  it('rebuilds without the ones read, and takes it down once none are left', () => {
    const { queue, shown, advance } = harness()
    queue.add(message('m1'), { audio: false })
    queue.add(message('m2'), { audio: false })
    advance(REBUILD_EVERY_MS)
    queue.remove(['m2'])
    advance(REBUILD_EVERY_MS)
    expect(shown.at(-1)).toMatchObject({ title: 'Alice', body: 'says m1' })
    queue.remove(['m1'])
    advance(REBUILD_EVERY_MS)
    expect(shown.at(-1)).toBeNull()
  })

  it('starts afresh once the window has focus', () => {
    const { queue, shown, advance } = harness()
    queue.add(message('m1'), { audio: false })
    advance(REBUILD_EVERY_MS)
    queue.clear()
    queue.add(message('m3'), { audio: false })
    advance(REBUILD_EVERY_MS)
    expect(shown.at(-1)).toMatchObject({ title: 'Alice', body: 'says m3' })
  })

  it('holds what arrives after connecting, then shows it as one', () => {
    const { queue, shown, advance } = harness()
    queue.holdFor(HOLD_AFTER_CONNECT_MS)
    queue.add(message('m1'), { audio: false })
    queue.add(message('m2'), { audio: false })
    advance(HOLD_AFTER_CONNECT_MS - 1)
    expect(shown).toEqual([])
    advance(1)
    expect(shown).toHaveLength(1)
    expect(shown[0]?.title).toBe(tr('messageNew', { count: 2 }))
  })

  it('names the newest by when it was sent, whatever order a batch came in', () => {
    const { queue, shown, advance } = harness()
    queue.add(message('m2', { timestamp: 20, sender: 'Bob', conversationId: BOB }), {
      audio: false,
    })
    queue.add(message('m1', { timestamp: 10 }), { audio: false })
    advance(REBUILD_EVERY_MS)
    expect(shown[0]?.body).toBe(`${tr('notificationsMostRecent', { name: 'Bob' })}: says m2`)
    expect(shown[0]?.tap).toEqual({ kind: 'conversation', conversationId: BOB, messageId: 2 })
  })

  it('counts a message once, however often it is posted', () => {
    const { queue, shown, advance } = harness()
    queue.add(message('m1'), { audio: false })
    queue.add(message('m1'), { audio: false })
    advance(REBUILD_EVERY_MS)
    expect(shown[0]).toMatchObject({ title: 'Alice' })
  })
})
