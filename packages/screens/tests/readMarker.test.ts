import type { ConversationId, Message, SessionClient } from '@session/client'
import { friends, type FakeAccount, type FakeWorld } from '@session/client/fake'
import { createSessionStore, type SessionStore } from '@session/state'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { createReadMarker, READ_SETTLE_MS, readTarget, type ReadView } from '#src/readMarker'

/**
 * The open conversation keeping itself read, driven the way the screen drives it: a store on the
 * fake client, and the marker handed the conversation's view on every change. There is no renderer
 * in this package, so the store subscription stands in for the screen's effect.
 */

/** A message for the pure cases, which need only its direction and time. */
function incoming(id: number, timestamp: number, outgoing = false): Message {
  return {
    id,
    conversationId: 'bob',
    author: outgoing ? 'alice' : 'bob',
    timestamp,
    body: '',
    outgoing,
    sendState: 'sent',
    attachments: [],
    galleryViewable: false,
  }
}

/** A window port whose focus the test moves. */
function focusPort(initial: boolean) {
  let focused = initial
  const handlers = new Set<(focused: boolean) => void>()
  return {
    isFocused: () => focused,
    onFocusChange: (handler: (focused: boolean) => void) => {
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    },
    set(now: boolean): void {
      focused = now
      for (const handler of handlers) handler(now)
    },
  }
}

/** What the conversation screen passes the marker, read off the store. */
function viewOf(store: SessionStore, id: ConversationId): ReadView {
  const state = store.getState()
  const conversation = state.conversations.find((c) => c.id === id)
  const window = state.histories[id]
  return {
    ready: window?.ready ?? false,
    messages: window?.messages ?? [],
    unreadCount: conversation?.unreadCount ?? 0,
    markedUnread: conversation?.markedUnread ?? false,
  }
}

interface Opened {
  world: FakeWorld
  client: SessionClient
  store: SessionStore
  bob: FakeAccount
  focus: ReturnType<typeof focusPort>
  markRead: MockInstance<SessionClient['markRead']>
  /** The count libsession would report, read back through the client rather than the store. */
  unread: () => Promise<number | undefined>
  /** Delivers one message from Bob to Alice, and answers its timestamp. */
  receive: (body: string) => number
  close: () => void
}

/** Alice, with the conversation with Bob open on screen. */
async function opened({
  history = 4,
  focused = true,
}: { history?: number; focused?: boolean } = {}): Promise<Opened> {
  // Odd-numbered history comes from Bob, so four messages leave Alice two unread.
  const { world, clients } = friends(['Alice', 'Bob'], { history })
  const client = clients['Alice']
  if (!client) throw new Error('fixture did not produce a client')
  const bob = world.account('Bob')
  const alice = world.account('Alice')
  const store = createSessionStore(client)
  await store.actions.hydrate()
  await store.actions.loadHistory(bob.sessionId)

  const markRead = vi.spyOn(client, 'markRead')
  const focus = focusPort(focused)
  const marker = createReadMarker({
    markRead: (upToMs) => store.actions.markRead(bob.sessionId, upToMs),
    focus,
    settleMs: READ_SETTLE_MS,
  })
  const show = (): void => {
    marker.update(viewOf(store, bob.sessionId))
  }
  const unsubscribe = store.subscribe(show)
  show()

  return {
    world,
    client,
    store,
    bob,
    focus,
    markRead,
    unread: async () =>
      (await client.getConversations()).find((c) => c.id === bob.sessionId)?.unreadCount,
    receive: (body) => {
      bob.send(alice.sessionId, body)
      world.settle()
      const newest = alice.messages(bob.sessionId).at(-1)
      if (newest === undefined || newest.outgoing) throw new Error('the message did not arrive')
      return newest.timestamp
    },
    close: () => {
      unsubscribe()
      marker.dispose()
    },
  }
}

/** The newest incoming message's timestamp: what an open conversation reads up to. */
function newestIncoming(store: SessionStore, id: ConversationId): number {
  const target = readTarget({ ...viewOf(store, id), unreadCount: 1 })
  if (target === undefined) throw new Error('no incoming message')
  return target
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('opening a conversation', () => {
  it('marks it read, up to the newest message shown', async () => {
    const { store, bob, markRead, unread, close } = await opened()
    expect(await unread()).toBe(2)

    vi.advanceTimersByTime(READ_SETTLE_MS)

    expect(markRead).toHaveBeenCalledTimes(1)
    expect(markRead).toHaveBeenCalledWith(bob.sessionId, newestIncoming(store, bob.sessionId))
    expect(await unread()).toBe(0)
    // And the list's copy, which is what clears the badge.
    expect(store.getState().conversations.find((c) => c.id === bob.sessionId)?.unreadCount).toBe(0)
    close()
  })

  it('does not call when nothing is unread', async () => {
    const { markRead, close } = await opened({ history: 1 })
    vi.advanceTimersByTime(READ_SETTLE_MS * 10)
    expect(markRead).not.toHaveBeenCalled()
    close()
  })

  it('leaves a conversation with no messages alone, even one marked unread', async () => {
    const { world, bob, markRead, close } = await opened({ history: 0 })
    world.account('Alice').touch(bob.sessionId, { markedUnread: true })
    vi.advanceTimersByTime(READ_SETTLE_MS * 10)
    expect(markRead).not.toHaveBeenCalled()
    close()
  })

  it('clears a conversation that was marked unread', async () => {
    const { world, store, bob, markRead, close } = await opened()
    vi.advanceTimersByTime(READ_SETTLE_MS)
    close()
    markRead.mockClear()

    // Marked unread from the list, then opened again: nothing is unread, but the flag is.
    world.account('Alice').touch(bob.sessionId, { markedUnread: true })
    const marker = createReadMarker({
      markRead: (upToMs) => store.actions.markRead(bob.sessionId, upToMs),
      focus: focusPort(true),
      settleMs: READ_SETTLE_MS,
    })
    marker.update(viewOf(store, bob.sessionId))
    vi.advanceTimersByTime(READ_SETTLE_MS)
    marker.dispose()

    expect(markRead).toHaveBeenCalledTimes(1)
    expect(store.getState().conversations.find((c) => c.id === bob.sessionId)?.markedUnread).toBe(
      false,
    )
  })

  it('makes a mark still waiting when the screen closes', async () => {
    const { markRead, unread, close } = await opened()
    close()
    expect(markRead).toHaveBeenCalledTimes(1)
    expect(await unread()).toBe(0)
  })
})

describe('while it is open', () => {
  it('marks a new message read as it arrives', async () => {
    const { bob, markRead, unread, receive, close } = await opened()
    vi.advanceTimersByTime(READ_SETTLE_MS)
    expect(markRead).toHaveBeenCalledTimes(1)

    const timestamp = receive('are you there?')
    expect(await unread()).toBe(1)
    vi.advanceTimersByTime(READ_SETTLE_MS)

    expect(markRead).toHaveBeenCalledTimes(2)
    expect(markRead).toHaveBeenLastCalledWith(bob.sessionId, timestamp)
    expect(await unread()).toBe(0)
    close()
  })

  it('marks a burst once, after it stops', async () => {
    const { bob, markRead, unread, receive, close } = await opened()
    vi.advanceTimersByTime(READ_SETTLE_MS)
    markRead.mockClear()

    let last = 0
    for (const body of ['one', 'two', 'three', 'four']) {
      last = receive(body)
      vi.advanceTimersByTime(READ_SETTLE_MS / 2)
    }
    expect(markRead).not.toHaveBeenCalled()
    vi.advanceTimersByTime(READ_SETTLE_MS)

    expect(markRead).toHaveBeenCalledTimes(1)
    expect(markRead).toHaveBeenCalledWith(bob.sessionId, last)
    expect(await unread()).toBe(0)
    close()
  })

  it('is not held back by changes that are not arrivals', async () => {
    const { world, client, bob, markRead, receive, close } = await opened()
    vi.advanceTimersByTime(READ_SETTLE_MS)
    markRead.mockClear()

    receive('hello')
    // Alice's own send moving through its states keeps changing the transcript.
    for (let i = 0; i < 4; i += 1) {
      await client.sendMessage(bob.sessionId, { body: `reply ${String(i)}` })
      world.advance()
      vi.advanceTimersByTime(READ_SETTLE_MS / 2)
    }

    expect(markRead).toHaveBeenCalledTimes(1)
    close()
  })
})

describe('in the background', () => {
  it('does not mark until the app comes back', async () => {
    const { focus, markRead, unread, close } = await opened({ focused: false })
    vi.advanceTimersByTime(READ_SETTLE_MS * 10)
    expect(markRead).not.toHaveBeenCalled()
    expect(await unread()).toBe(2)

    focus.set(true)
    vi.advanceTimersByTime(READ_SETTLE_MS)
    expect(markRead).toHaveBeenCalledTimes(1)
    expect(await unread()).toBe(0)
    close()
  })

  it('leaves a message that arrives in the background unread', async () => {
    const { focus, markRead, unread, receive, close } = await opened()
    vi.advanceTimersByTime(READ_SETTLE_MS)
    markRead.mockClear()

    focus.set(false)
    receive('while you were away')
    vi.advanceTimersByTime(READ_SETTLE_MS * 10)
    expect(markRead).not.toHaveBeenCalled()
    expect(await unread()).toBe(1)

    focus.set(true)
    vi.advanceTimersByTime(READ_SETTLE_MS)
    expect(markRead).toHaveBeenCalledTimes(1)
    expect(await unread()).toBe(0)
    close()
  })

  it('drops a mark still waiting when the app leaves, and when the screen then closes', async () => {
    const { focus, markRead, unread, close } = await opened()
    focus.set(false)
    vi.advanceTimersByTime(READ_SETTLE_MS * 10)
    close()
    expect(markRead).not.toHaveBeenCalled()
    expect(await unread()).toBe(2)
  })
})

describe('a mark that fails', () => {
  it('is reported, and asked for again on the next change', async () => {
    const failures: unknown[] = []
    const attempts: number[] = []
    const focus = focusPort(true)
    const marker = createReadMarker({
      markRead: (upToMs) => {
        attempts.push(upToMs)
        return attempts.length === 1 ? Promise.reject(new Error('closed')) : Promise.resolve()
      },
      focus,
      settleMs: READ_SETTLE_MS,
      onError: (error) => failures.push(error),
    })
    const view: ReadView = {
      ready: true,
      messages: [incoming(1, 1000)],
      unreadCount: 1,
      markedUnread: false,
    }

    marker.update(view)
    vi.advanceTimersByTime(READ_SETTLE_MS)
    await Promise.resolve()
    expect(failures).toHaveLength(1)

    focus.set(false)
    focus.set(true)
    vi.advanceTimersByTime(READ_SETTLE_MS)
    expect(attempts).toEqual([1000, 1000])
    marker.dispose()
  })
})

describe('what is read up to', () => {
  const base: ReadView = { ready: true, messages: [], unreadCount: 1, markedUnread: false }

  it('is the newest incoming message, not a newer one of our own', () => {
    // Our clock and the sender's differ, so an outgoing timestamp could pass over a message that
    // was sent earlier and has not arrived yet.
    const messages = [incoming(1, 1000), incoming(2, 3000), incoming(3, 5000, true)]
    expect(readTarget({ ...base, messages })).toBe(3000)
  })

  it('is nothing before the transcript has loaded', () => {
    expect(readTarget({ ...base, ready: false, messages: [incoming(1, 1000)] })).toBeUndefined()
  })

  it('is nothing when there are only our own messages', () => {
    expect(readTarget({ ...base, messages: [incoming(1, 1000, true)] })).toBeUndefined()
  })

  it('is nothing when nothing is unread', () => {
    expect(readTarget({ ...base, unreadCount: 0, messages: [incoming(1, 1000)] })).toBeUndefined()
  })
})
