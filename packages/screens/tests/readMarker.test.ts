import type { ConversationId, Message, SessionClient } from '@session/client'
import { friends, type FakeAccount, type FakeWorld } from '@session/client/fake'
import { createSessionStore, type SessionStore } from '@session/state'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import {
  CLEAR_FLAG_ONLY,
  createReadMarker,
  READ_MAX_WAIT_MS,
  READ_SETTLE_MS,
  readTarget,
  type ReadView,
} from '#src/readMarker'

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
    gallery: false,
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

/**
 * What the conversation screen passes the marker, read off the store, with every loaded message on
 * screen unless the test says how many of the oldest are.
 */
function viewOf(store: SessionStore, id: ConversationId, seenCount?: number): ReadView {
  const state = store.getState()
  const conversation = state.conversations.find((c) => c.id === id)
  const window = state.histories[id]
  const messages = window?.messages ?? []
  return {
    ready: (window?.ready ?? false) && conversation !== undefined,
    covered: false,
    messages: seenCount === undefined ? messages : messages.slice(0, seenCount),
    lastActivity: conversation?.lastActivity,
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
    maxWaitMs: READ_MAX_WAIT_MS,
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

/** Alice's store with Bob's conversation loaded, for tests that drive their own marker. */
async function friendsOpen() {
  const { world, clients } = friends(['Alice', 'Bob'], { history: 4 })
  const client = clients['Alice']
  if (!client) throw new Error('fixture did not produce a client')
  const store = createSessionStore(client)
  await store.actions.hydrate()
  await store.actions.loadHistory(world.account('Bob').sessionId)
  return { world, client, store }
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

    // Marked unread on another device, then opened again: nothing is unread, but the flag is.
    world.account('Alice').touch(bob.sessionId, { markedUnread: true })
    const marker = createReadMarker({
      markRead: (upToMs) => store.actions.markRead(bob.sessionId, upToMs),
      focus: focusPort(true),
      settleMs: READ_SETTLE_MS,
      maxWaitMs: READ_MAX_WAIT_MS,
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
      maxWaitMs: READ_MAX_WAIT_MS,
      onError: (error) => failures.push(error),
    })
    const view: ReadView = {
      ready: true,
      covered: false,
      messages: [incoming(1, 1000)],
      lastActivity: 1,
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
  const base: ReadView = {
    ready: true,
    covered: false,
    messages: [],
    lastActivity: undefined,
    unreadCount: 1,
    markedUnread: false,
  }

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

describe('only what has been seen', () => {
  it('marks up to the newest message on screen, and further as more come into view', async () => {
    const { world, client, store } = await friendsOpen()
    const bob = world.account('Bob')
    const markRead = vi.spyOn(client, 'markRead')
    const marker = createReadMarker({
      markRead: (upToMs) => store.actions.markRead(bob.sessionId, upToMs),
      focus: focusPort(true),
      settleMs: READ_SETTLE_MS,
      maxWaitMs: READ_MAX_WAIT_MS,
    })
    // Only the first two on screen, so only the incoming message among them counts.
    const firstTwo = viewOf(store, bob.sessionId, 2)
    marker.update(firstTwo)
    vi.advanceTimersByTime(READ_SETTLE_MS)
    const seenTarget = readTarget(firstTwo)
    expect(seenTarget).toBeDefined()
    expect(seenTarget).toBeLessThan(newestIncoming(store, bob.sessionId))
    expect(markRead).toHaveBeenLastCalledWith(bob.sessionId, seenTarget)

    marker.update(viewOf(store, bob.sessionId))
    vi.advanceTimersByTime(READ_SETTLE_MS)
    expect(markRead).toHaveBeenLastCalledWith(bob.sessionId, newestIncoming(store, bob.sessionId))
    marker.dispose()
  })

  it('marks nothing while no unread message is on screen', async () => {
    const { world, client, store } = await friendsOpen()
    const bob = world.account('Bob')
    const markRead = vi.spyOn(client, 'markRead')
    const marker = createReadMarker({
      markRead: (upToMs) => store.actions.markRead(bob.sessionId, upToMs),
      focus: focusPort(true),
      settleMs: READ_SETTLE_MS,
      maxWaitMs: READ_MAX_WAIT_MS,
    })
    marker.update(viewOf(store, bob.sessionId, 0))
    vi.advanceTimersByTime(READ_SETTLE_MS * 10)
    expect(markRead).not.toHaveBeenCalled()
    marker.dispose()
  })
})

describe('marked unread while it is open', () => {
  /** Opened and read, then marked unread on another device. */
  async function markedWhileOpen() {
    const open = await opened()
    vi.advanceTimersByTime(READ_SETTLE_MS)
    open.markRead.mockClear()
    open.world.account('Alice').touch(open.bob.sessionId, { markedUnread: true })
    return open
  }

  it('stays marked unread while the reader is still looking at it', async () => {
    const { store, bob, markRead, close } = await markedWhileOpen()
    vi.advanceTimersByTime(READ_SETTLE_MS * 10)
    expect(markRead).not.toHaveBeenCalled()
    expect(store.getState().conversations.find((c) => c.id === bob.sessionId)?.markedUnread).toBe(
      true,
    )
    close()
  })

  it('is read again when a message arrives', async () => {
    const { receive, markRead, close } = await markedWhileOpen()
    receive('back again')
    vi.advanceTimersByTime(READ_SETTLE_MS)
    expect(markRead).toHaveBeenCalledTimes(1)
    close()
  })

  it('is read again when the reader sends a message', async () => {
    const { world, bob, markRead, close } = await markedWhileOpen()
    world.account('Alice').send(bob.sessionId, 'a reply')
    world.settle()
    vi.advanceTimersByTime(READ_SETTLE_MS)
    expect(markRead).toHaveBeenCalledTimes(1)
    close()
  })

  it('ends the hold when another device reads it, so the next arrival is marked as usual', async () => {
    const { world, bob, receive, markRead, close } = await markedWhileOpen()
    world.account('Alice').touch(bob.sessionId, { markedUnread: false })
    vi.advanceTimersByTime(READ_SETTLE_MS)
    expect(markRead).not.toHaveBeenCalled()
    receive('later')
    vi.advanceTimersByTime(READ_SETTLE_MS)
    expect(markRead).toHaveBeenCalledTimes(1)
    close()
  })
})

/** A marker on pure views, recording what it asks for. */
function recordingMarker() {
  const asked: number[] = []
  const marker = createReadMarker({
    markRead: (upToMs) => {
      asked.push(upToMs)
      return Promise.resolve()
    },
    focus: focusPort(true),
    settleMs: READ_SETTLE_MS,
    maxWaitMs: READ_MAX_WAIT_MS,
  })
  return { asked, marker }
}

const unreadView: ReadView = {
  ready: true,
  covered: false,
  messages: [incoming(1, 1000)],
  lastActivity: 1000,
  unreadCount: 1,
  markedUnread: false,
}

describe('covered by something drawn over it', () => {
  it('marks nothing while covered, and marks once it is uncovered', () => {
    const { asked, marker } = recordingMarker()
    marker.update({ ...unreadView, covered: true })
    vi.advanceTimersByTime(READ_SETTLE_MS * 10)
    expect(asked).toEqual([])

    marker.update(unreadView)
    vi.advanceTimersByTime(READ_SETTLE_MS)
    expect(asked).toEqual([1000])
    marker.dispose()
  })

  it('drops a mark still waiting when it is covered', () => {
    const { asked, marker } = recordingMarker()
    marker.update(unreadView)
    marker.update({ ...unreadView, covered: true })
    vi.advanceTimersByTime(READ_SETTLE_MS * 10)
    marker.dispose()
    expect(asked).toEqual([])
  })
})

describe('marked unread with no incoming message on screen', () => {
  it('clears the flag without moving the read point', async () => {
    const { world, clients } = friends(['Alice', 'Bob'], { history: 0 })
    const client = clients['Alice']
    if (!client) throw new Error('fixture did not produce a client')
    const bob = world.account('Bob')
    const alice = world.account('Alice')
    const store = createSessionStore(client)
    await store.actions.hydrate()
    await store.actions.loadHistory(bob.sessionId)
    // Only our own message, then marked unread on another device before it is opened.
    alice.send(bob.sessionId, 'note to self, more or less')
    world.settle()
    alice.touch(bob.sessionId, { markedUnread: true })
    await store.actions.loadHistory(bob.sessionId)
    const markRead = vi.spyOn(client, 'markRead')
    const marker = createReadMarker({
      markRead: (upToMs) => store.actions.markRead(bob.sessionId, upToMs),
      focus: focusPort(true),
      settleMs: READ_SETTLE_MS,
      maxWaitMs: READ_MAX_WAIT_MS,
    })

    marker.update(viewOf(store, bob.sessionId))
    vi.advanceTimersByTime(READ_SETTLE_MS)
    marker.dispose()

    expect(markRead).toHaveBeenCalledWith(bob.sessionId, CLEAR_FLAG_ONLY)
    const row = store.getState().conversations.find((c) => c.id === bob.sessionId)
    expect(row?.markedUnread).toBe(false)
    expect(row?.unreadCount).toBe(0)
  })

  it('leaves the flag while an unread message is off screen', () => {
    expect(
      readTarget({ ...unreadView, messages: [], unreadCount: 1, markedUnread: true }),
    ).toBeUndefined()
  })
})

describe('the hold, from what the marker knows', () => {
  it('ends when the unread count rises, though the last activity stays', () => {
    const { asked, marker } = recordingMarker()
    const read: ReadView = { ...unreadView, unreadCount: 0 }
    marker.update(read)
    marker.update({ ...read, markedUnread: true })
    vi.advanceTimersByTime(READ_SETTLE_MS * 10)
    expect(asked).toEqual([])

    // A reply stamped by a slow clock: counted unread, and older than our last message.
    marker.update({
      ...read,
      markedUnread: true,
      unreadCount: 1,
      messages: [incoming(1, 1000), incoming(2, 900)],
    })
    vi.advanceTimersByTime(READ_SETTLE_MS)
    expect(asked).toEqual([1000])
    marker.dispose()
  })

  it('does not start from a row that was not loaded yet', () => {
    const { asked, marker } = recordingMarker()
    marker.update({ ...unreadView, ready: false, unreadCount: 0 })
    marker.update({ ...unreadView, unreadCount: 0, markedUnread: true })
    vi.advanceTimersByTime(READ_SETTLE_MS)
    expect(asked).toEqual([1000])
    marker.dispose()
  })
})

describe('a stream of arrivals', () => {
  it('is marked within the longest wait, though it never stops', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const { asked, marker } = recordingMarker()
    let timestamp = 1000
    const arrive = (): void => {
      timestamp += 1
      marker.update({ ...unreadView, messages: [incoming(timestamp, timestamp)] })
    }
    arrive()
    for (let elapsed = 0; elapsed < READ_MAX_WAIT_MS; elapsed += READ_SETTLE_MS / 2) {
      vi.advanceTimersByTime(READ_SETTLE_MS / 2)
      if (asked.length > 0) break
      arrive()
    }
    expect(asked).toHaveLength(1)
    marker.dispose()
  })
})
