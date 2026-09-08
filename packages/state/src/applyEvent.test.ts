import type { Conversation, Message, SessionEvent } from '@session/client'
import { describe, expect, it } from 'vitest'

import { applyEvent } from './applyEvent'
import { emptyState, type SessionState } from './types'

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: '05alice',
    kind: 'dm',
    displayName: 'Alice',
    lastActivity: 1000,
    priority: 0,
    unreadCount: 0,
    markedUnread: false,
    autoDownload: 'none',
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
    ...overrides,
  }
}

function replay(events: SessionEvent[], from: SessionState = emptyState): SessionState {
  return events.reduce(applyEvent, from)
}

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

    expect(state.conversationOrder).toEqual(['a', 'b', 'c'])
  })

  it('moves an approved conversation out of the request list', () => {
    const asRequest = conversation({ request: true })
    const state = replay([
      { type: 'conversation-added', conversation: asRequest },
      { type: 'conversation-updated', conversation: { ...asRequest, request: false } },
    ])

    // Approval is an update, not a remove-then-add, so the row has to be taken out of the
    // list it used to be in - otherwise it shows up in both.
    expect(state.requestOrder).toEqual([])
    expect(state.requests['05alice']).toBeUndefined()
    expect(state.conversationOrder).toEqual(['05alice'])
  })

  it('is unchanged by replaying the same event', () => {
    const event: SessionEvent = { type: 'conversation-added', conversation: conversation() }
    const once = replay([event])
    const twice = replay([event, event])

    expect(twice.conversationOrder).toEqual(once.conversationOrder)
    expect(twice.conversations).toEqual(once.conversations)
  })

  it('ignores messages for a conversation whose history was never loaded', () => {
    const state = replay([
      { type: 'conversation-added', conversation: conversation() },
      { type: 'message-added', conversationId: '05alice', message: message() },
    ])

    // A window built from one event would look complete and would not be.
    expect(state.histories['05alice']).toBeUndefined()
  })

  it('inserts a message into a loaded window in timestamp order', () => {
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

    const state = applyEvent(seeded, {
      type: 'message-added',
      conversationId: '05alice',
      message: message({ id: 2, timestamp: 2000 }),
    })

    expect(state.histories['05alice']?.messages.map((m) => m.id)).toEqual([1, 2, 3])
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
      type: 'message-updated',
      conversationId: '05alice',
      message: message({ id: 1, sendState: 'sent' }),
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

  it('retires a transfer once a report carries a result', () => {
    const started = applyEvent(emptyState, {
      type: 'attachment-progress',
      progress: { messageId: 1, index: 0, done: 0, total: 0 },
    })
    expect(started.transfers['1:0']).toBeDefined()

    const halfway = applyEvent(started, {
      type: 'attachment-progress',
      progress: { messageId: 1, index: 0, done: 50, total: 100 },
    })
    // done === total is not finished; only a result is.
    expect(halfway.transfers['1:0']?.done).toBe(50)

    const finished = applyEvent(halfway, {
      type: 'attachment-progress',
      progress: { messageId: 1, index: 0, done: 100, total: 100, result: 0 },
    })
    expect(finished.transfers['1:0']).toBeUndefined()
  })

  it('forgets a removed conversation everywhere at once', () => {
    const state = replay([
      { type: 'conversation-added', conversation: conversation() },
      { type: 'conversation-removed', conversationId: '05alice' },
    ])

    expect(state.conversations['05alice']).toBeUndefined()
    expect(state.conversationOrder).toEqual([])
    expect(state.histories['05alice']).toBeUndefined()
  })
})
