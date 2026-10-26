import type { Conversation, Message, SessionEvent } from '@session/client'
import { describe, expect, it } from 'vitest'

import { applyEvent, mergePages, recordRefusal } from '#src/applyEvent'
import { emptyState, type SessionState } from '#src/types'

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: '05alice',
    kind: 'dm',
    displayName: 'Alice',
    lastActivity: 1000,
    priority: 0,
    unreadCount: 0,
    markedUnread: false,
    request: false,
    awaitingApproval: false,
    noteToSelf: false,
    blocked: false,
    ...overrides,
  }
}

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 1,
    conversationId: '05alice',
    author: '05alice',
    timestamp: 1000,
    body: 'hello',
    outgoing: false,
    sendState: 'sent',
    attachments: [],
    galleryViewable: false,
    ...overrides,
  }
}

/**
 * A loaded history holding the message the reports below are about.
 *
 * A report names a message and not a conversation, so what decides whether one is kept is
 * whether some loaded window holds that message.
 */
function loaded(messages: Message[] = [message()]): SessionState {
  return {
    ...emptyState,
    histories: {
      '05alice': { ready: true, messages, exhausted: true, fetching: false },
    },
  }
}

function progress(
  overrides: Partial<Extract<SessionEvent, { type: 'attachment-progress' }>> = {},
): SessionEvent {
  return {
    type: 'attachment-progress',
    transfer: 'download',
    messageId: 1,
    index: 0,
    doneBytes: 0,
    totalBytes: 0,
    ...overrides,
  }
}

function replay(events: SessionEvent[], from: SessionState = emptyState): SessionState {
  return events.reduce(applyEvent, from)
}

const ids = (list: Conversation[]): string[] => list.map((c) => c.id)

describe('applyEvent', () => {
  it('keeps the order libsession sent, rather than imposing one', () => {
    // Deliberately not the order our own comparator would produce: libsession orders both lists
    // in SQL, and it orders them differently from each other - requests carry no priority term.
    // A store that re-sorted would disagree with the request list today and with any later change
    // to the sort rules.
    const state = replay([
      {
        type: 'conversation-list-replaced',
        conversations: [
          conversation({ id: 'a', lastActivity: 3000 }),
          conversation({ id: 'b', lastActivity: 1000, priority: 1 }),
          conversation({ id: 'c', lastActivity: 2000 }),
        ],
      },
    ])

    expect(ids(state.conversations)).toEqual(['a', 'b', 'c'])
  })

  it('moves an approved conversation out of the request list', () => {
    const asRequest = conversation({ request: true })
    const state = replay([
      { type: 'conversation-added', conversation: asRequest },
      { type: 'conversation-updated', conversation: { ...asRequest, request: false } },
    ])

    // Approval is an update, not a remove-then-add, so the row has to be taken out of the
    // list it used to be in - otherwise it shows up in both.
    expect(ids(state.requests)).toEqual([])
    expect(ids(state.conversations)).toEqual(['05alice'])
  })

  it('is unchanged by replaying the same event', () => {
    const event: SessionEvent = { type: 'conversation-added', conversation: conversation() }
    const once = replay([event])
    const twice = replay([event, event])

    expect(twice.conversations).toEqual(once.conversations)
  })

  it('ignores messages for a conversation whose history was never loaded', () => {
    const state = replay([
      { type: 'conversation-added', conversation: conversation() },
      { type: 'messages-added', messages: [message()] },
    ])

    // A window built from one event would look complete and would not be.
    expect(state.histories['05alice']).toBeUndefined()
  })

  it('puts an added message on the end, rather than deciding where it belongs', () => {
    const seeded: SessionState = {
      ...emptyState,
      histories: {
        '05alice': {
          ready: true,
          messages: [message({ id: 1, timestamp: 1000 }), message({ id: 3, timestamp: 3000 })],
          exhausted: true,
          fetching: false,
        },
      },
    }

    // A timestamp that would sort between the two, to show it is not sorted in: the event
    // reports what libsession just recorded, and the transcript reads in libsession's order.
    const state = applyEvent(seeded, {
      type: 'messages-added',
      messages: [message({ id: 2, timestamp: 2000 })],
    })

    expect(state.histories['05alice']?.messages.map((m) => m.id)).toEqual([1, 3, 2])
  })

  it('replaces a message in place when its send state changes', () => {
    const seeded: SessionState = {
      ...emptyState,
      histories: {
        '05alice': {
          ready: true,
          messages: [message({ id: 1, sendState: 'sending' })],
          exhausted: true,
          fetching: false,
        },
      },
    }

    const state = applyEvent(seeded, {
      type: 'messages-updated',
      messages: [message({ id: 1, sendState: 'sent' })],
    })

    const messages = state.histories['05alice']?.messages ?? []
    expect(messages.length).toBe(1)
    expect(messages[0]?.sendState).toBe('sent')
  })

  it('drops the window on history-replaced so the screen refetches', () => {
    const seeded: SessionState = {
      ...emptyState,
      histories: {
        '05alice': { ready: true, messages: [message()], exhausted: true, fetching: false },
      },
    }

    const state = applyEvent(seeded, { type: 'history-replaced', conversationId: '05alice' })

    expect(state.histories['05alice']?.ready).toBe(false)
    expect(state.histories['05alice']?.messages).toEqual([])
  })

  it('forgets a removed conversation everywhere at once', () => {
    const state = replay([
      { type: 'conversation-added', conversation: conversation() },
      { type: 'conversation-removed', conversationId: '05alice' },
    ])

    expect(ids(state.conversations)).toEqual([])
    expect(state.histories['05alice']).toBeUndefined()
  })

  it('appends a conversation it has not seen, and leaves an updated one where it was', () => {
    const seeded = replay([
      {
        type: 'conversation-list-replaced',
        conversations: [
          conversation({ id: 'a', lastActivity: 3000 }),
          conversation({ id: 'b', lastActivity: 2000 }),
          conversation({ id: 'c', lastActivity: 1000 }),
        ],
      },
    ])

    // A rank that would sort to the front under any comparator: it still goes on the end, because
    // libsession follows with a replacement carrying the real order.
    const added = applyEvent(seeded, {
      type: 'conversation-added',
      conversation: conversation({ id: 'top', lastActivity: 9000, priority: 2 }),
    })
    expect(ids(added.conversations)).toEqual(['a', 'b', 'c', 'top'])

    const updated = applyEvent(seeded, {
      type: 'conversation-updated',
      conversation: conversation({ id: 'c', lastActivity: 4000 }),
    })
    expect(ids(updated.conversations)).toEqual(['a', 'b', 'c'])
    expect(updated.conversations.find((c) => c.id === 'c')?.lastActivity).toBe(4000)
  })

  it('keeps the same order array when only a field changed', () => {
    const seeded = replay([
      {
        type: 'conversation-list-replaced',
        conversations: [
          conversation({ id: 'a', lastActivity: 3000 }),
          conversation({ id: 'b', lastActivity: 2000 }),
        ],
      },
    ])

    const state = applyEvent(seeded, {
      type: 'conversation-updated',
      conversation: conversation({ id: 'b', lastActivity: 2000, unreadCount: 3 }),
    })

    // The row it replaced keeps its place, so the list still reads in libsession's order.
    expect(ids(state.conversations)).toEqual(ids(seeded.conversations))
    expect(state.conversations.find((c) => c.id === 'b')?.unreadCount).toBe(3)
  })

  it('leaves the other list alone when the conversation was never in it', () => {
    const seeded = replay([
      { type: 'conversation-added', conversation: conversation({ id: 'req', request: true }) },
    ])

    const state = applyEvent(seeded, {
      type: 'conversation-added',
      conversation: conversation({ id: 'friend' }),
    })

    // The same array, not merely an equal one: a screen watching the request list must not
    // re-render because a conversation it does not hold changed.
    expect(state.requests).toBe(seeded.requests)
    expect(ids(state.conversations)).toEqual(['friend'])
  })

  it('appends a message that is newer than the whole window', () => {
    const seeded: SessionState = {
      ...emptyState,
      histories: {
        '05alice': {
          ready: true,
          messages: [message({ id: 1, timestamp: 1000 }), message({ id: 2, timestamp: 2000 })],
          exhausted: true,
          fetching: false,
        },
      },
    }

    const state = applyEvent(seeded, {
      type: 'messages-added',
      messages: [message({ id: 3, timestamp: 3000 })],
    })

    expect(state.histories['05alice']?.messages.map((m) => m.id)).toEqual([1, 2, 3])
  })

  it('applies a batch spanning conversations to each loaded window, in order', () => {
    const seeded: SessionState = {
      ...emptyState,
      histories: {
        '05alice': {
          ready: true,
          messages: [message({ id: 1 })],
          exhausted: true,
          fetching: false,
        },
        '05bob': {
          ready: true,
          messages: [message({ id: 2, conversationId: '05bob' })],
          exhausted: true,
          fetching: false,
        },
      },
    }

    const state = applyEvent(seeded, {
      type: 'messages-updated',
      messages: [
        message({ id: 1, body: 'first edit' }),
        message({ id: 2, conversationId: '05bob', body: 'bob edit' }),
        message({ id: 3, conversationId: '05carol' }),
        message({ id: 1, body: 'second edit' }),
      ],
    })

    expect(state.histories['05alice']?.messages.map((m) => m.body)).toEqual(['second edit'])
    expect(state.histories['05bob']?.messages.map((m) => m.body)).toEqual(['bob edit'])
    // Not loaded, so not started from one message.
    expect(state.histories['05carol']).toBeUndefined()
  })

  it('stores the conversation and message objects the events carried', () => {
    const convo = conversation()
    const msg = message()
    const seeded: SessionState = {
      ...emptyState,
      histories: { '05alice': { ready: true, messages: [], exhausted: true, fetching: false } },
    }
    const state = replay(
      [
        { type: 'conversation-added', conversation: convo },
        { type: 'messages-added', messages: [msg] },
      ],
      seeded,
    )

    expect(state.conversations[0]).toBe(convo)
    expect(state.histories['05alice']?.messages[0]).toBe(msg)
  })
})

describe('mergePages', () => {
  it('puts an older page in front of the loaded window without sorting', () => {
    const older = [message({ id: 1, timestamp: 1000 }), message({ id: 2, timestamp: 2000 })]
    const previous = [message({ id: 3, timestamp: 3000 })]

    expect(mergePages(older, previous).map((m) => m.id)).toEqual([1, 2, 3])
  })

  it('returns the page itself when nothing was loaded yet', () => {
    const page = [message({ id: 1 })]
    expect(mergePages(page, [])).toBe(page)
  })

  it('joins the pages as they came, without reordering the seam', () => {
    const older = [message({ id: 1, timestamp: 1000 }), message({ id: 3, timestamp: 3000 })]
    const previous = [message({ id: 2, timestamp: 2000 })]

    // Timestamps that interleave across the seam, which a sort would have straightened out.
    // A page is asked for from before the oldest message loaded, so an overlap is libsession
    // answering something other than what was asked - not something to paper over here.
    expect(mergePages(older, previous).map((m) => m.id)).toEqual([1, 3, 2])
  })
})

describe('attachment transfers', () => {
  it('records a report against the transfer it belongs to', () => {
    const state = replay(
      [progress(), progress({ doneBytes: 512, totalBytes: 2048 })],
      loaded([message()]),
    )

    expect(state.transfers[1]?.['download:0']).toEqual({
      state: 'running',
      doneBytes: 512,
      totalBytes: 2048,
    })
  })

  it('keeps a download and an export of the same attachment apart', () => {
    // One file can be downloading and exporting at once, on separate transfers if libsession's
    // `requested_cache_max_size` refuses it: keyed only by message and index the reports would
    // overwrite each other and the bar would jump backwards.
    const state = replay(
      [
        progress({ transfer: 'download', doneBytes: 1024, totalBytes: 2048 }),
        progress({ transfer: 'export', doneBytes: 64, totalBytes: 2048 }),
      ],
      loaded(),
    )

    expect(state.transfers[1]?.['download:0']?.doneBytes).toBe(1024)
    expect(state.transfers[1]?.['export:0']?.doneBytes).toBe(64)
  })

  it('returns the same state for a report identical to the stored one', () => {
    const before = replay([progress({ doneBytes: 512, totalBytes: 2048 })], loaded())
    const after = applyEvent(before, progress({ doneBytes: 512, totalBytes: 2048 }))
    expect(after).toBe(before)

    const failed = replay(
      [progress({ doneBytes: 0, totalBytes: 0, outcome: { ok: false, error: 'file.not_found' } })],
      loaded(),
    )
    expect(
      applyEvent(
        failed,
        progress({ doneBytes: 0, totalBytes: 0, outcome: { ok: false, error: 'file.not_found' } }),
      ),
    ).toBe(failed)
  })

  it('treats an ok outcome as finished and any other as failed', () => {
    const ok = replay(
      [progress({ doneBytes: 2048, totalBytes: 2048, outcome: { ok: true } })],
      loaded(),
    )
    expect(ok.transfers[1]?.['download:0']?.state).toBe('done')

    const bad = replay(
      [
        progress({
          doneBytes: 2048,
          totalBytes: 2048,
          outcome: { ok: false, error: 'file.unreadable' },
        }),
      ],
      loaded(),
    )
    expect(bad.transfers[1]?.['download:0']?.state).toBe('failed')
    expect(bad.transfers[1]?.['download:0']?.error).toBe('file.unreadable')
  })

  it('does not finish a transfer that has moved every byte but reported no outcome', () => {
    // doneBytes === totalBytes arrives before the verification does, so reading it as finished
    // shows a file as ready that may still fail.
    const state = replay([progress({ doneBytes: 2048, totalBytes: 2048 })], loaded())
    expect(state.transfers[1]?.['download:0']?.state).toBe('running')
  })

  it('drops reports for a conversation whose history is not loaded', () => {
    // An auto-downloading conversation reports whether or not anyone is looking at it.
    const state = replay([progress()], emptyState)
    expect(Object.keys(state.transfers)).toEqual([])
  })

  it('forgets a conversation transfers when its history is replaced', () => {
    const state = replay(
      [
        progress({ doneBytes: 512, totalBytes: 2048 }),
        { type: 'history-replaced', conversationId: '05alice' },
      ],
      loaded(),
    )
    expect(Object.keys(state.transfers)).toEqual([])
  })

  it('drops only the transfers of the messages in the replaced window', () => {
    const seeded: SessionState = {
      ...emptyState,
      histories: {
        '05alice': {
          ready: true,
          messages: [message({ id: 1 })],
          exhausted: true,
          fetching: false,
        },
        '05bob': {
          ready: true,
          messages: [message({ id: 2, conversationId: '05bob' })],
          exhausted: true,
          fetching: false,
        },
      },
    }
    const state = replay(
      [
        progress({ messageId: 1 }),
        progress({ messageId: 2 }),
        { type: 'history-replaced', conversationId: '05alice' },
      ],
      seeded,
    )
    expect(Object.keys(state.transfers)).toEqual(['2'])
  })

  it('forgets a removed conversation transfers', () => {
    const state = replay(
      [
        progress({ doneBytes: 512, totalBytes: 2048 }),
        { type: 'conversation-removed', conversationId: '05alice' },
      ],
      loaded(),
    )
    expect(state.transfers).toEqual({})
  })

  it('drops a report for a window history-replaced left unready', () => {
    const state = replay(
      [{ type: 'history-replaced', conversationId: '05alice' }, progress({ doneBytes: 512 })],
      loaded(),
    )
    expect(state.histories['05alice']?.ready).toBe(false)
    expect(state.transfers).toEqual({})
  })

  it('drops a finished download once its message is announced, so an eviction reads as absent', () => {
    const withFile = message({
      attachments: [
        {
          index: 0,
          voiceMessage: false,
          hasThumbhash: false,
          hasThumbnail: false,
          uploaded: true,
          availability: 'cached',
          fetchDoneBytes: 0,
          fetchTotalBytes: 0,
        },
      ],
    })
    const done = replay(
      [
        progress({ doneBytes: 9, totalBytes: 9, outcome: { ok: true } }),
        progress({ transfer: 'export', doneBytes: 9, totalBytes: 9, outcome: { ok: true } }),
      ],
      loaded([withFile]),
    )
    const announced = applyEvent(done, { type: 'messages-updated', messages: [withFile] })

    expect(announced.transfers[1]?.['download:0']).toBeUndefined()
    expect(announced.transfers[1]?.['export:0']?.state).toBe('done')
  })

  it('keeps a failed download when its message is announced', () => {
    // Availability cannot say a fetch failed transiently, so this report is the only record.
    const withFile = message({
      attachments: [
        {
          index: 0,
          voiceMessage: false,
          hasThumbhash: false,
          hasThumbnail: false,
          uploaded: true,
          availability: 'absent',
          fetchDoneBytes: 0,
          fetchTotalBytes: 0,
        },
      ],
    })
    const failed = replay([progress({ outcome: { ok: false } })], loaded([withFile]))
    const announced = applyEvent(failed, { type: 'messages-updated', messages: [withFile] })
    expect(announced.transfers[1]?.['download:0']?.state).toBe('failed')
  })

  it('records a refusal that reached no event as a failed transfer', () => {
    const refused = recordRefusal(loaded(), 'download', { messageId: 1, index: 0 })
    expect(refused.transfers[1]?.['download:0']).toEqual({
      state: 'failed',
      doneBytes: 0,
      totalBytes: 0,
    })
  })

  it('leaves a failed report from libsession in place of a refusal', () => {
    const reported = replay(
      [
        progress({
          doneBytes: 3,
          totalBytes: 9,
          outcome: { ok: false, error: 'file.download_failed' },
        }),
      ],
      loaded(),
    )
    expect(recordRefusal(reported, 'download', { messageId: 1, index: 0 })).toBe(reported)
  })

  it('leaves the transfer map alone when nothing in it changed', () => {
    const before = replay([progress()], loaded())
    const after = applyEvent(before, { type: 'history-replaced', conversationId: '05bob' })
    expect(after.transfers).toBe(before.transfers)
  })
})
