import { friends, type FakeWorld } from '@session/client/fake'
import type { MessagePage, SessionClient } from '@session/client'
import { beforeEach, describe, expect, it } from 'vitest'

import { createSessionStore, type SessionStore } from '#src/store'
import type { MessageWindow } from '#src/types'

/** Alice's conversation with Bob holding `m0` to `m99`, each a tick after the last. */
const HISTORY = 100

interface Fixture {
  store: SessionStore
  world: FakeWorld
  client: SessionClient
  bob: string
  window: () => MessageWindow
  bodies: () => string[]
}

async function longHistory(): Promise<Fixture> {
  const { world, clients } = friends(['Alice', 'Bob'])
  const client = clients['Alice']
  if (!client) throw new Error('fixture did not produce a client')
  const bob = world.account('Bob').sessionId
  for (let i = 0; i < HISTORY; i += 1) {
    const body = `m${String(i)}`
    await client.sendMessage(bob, { body })
    world.settle()
  }
  const store = createSessionStore(client)
  const window = (): MessageWindow => {
    const held = store.getState().histories[bob]
    if (held === undefined) throw new Error('no window is loaded')
    return held
  }
  return {
    store,
    world,
    client,
    bob,
    window,
    bodies: () => window().messages.map((m) => m.body),
  }
}

/** `m{from}` to `m{to}`, as a window holding exactly that run reads. */
function run(from: number, to: number): string[] {
  return Array.from({ length: to - from + 1 }, (_, i) => `m${String(from + i)}`)
}

describe('a window on a long history', () => {
  let fixture: Fixture
  beforeEach(async () => {
    fixture = await longHistory()
    await fixture.store.actions.loadHistory(fixture.bob)
  })

  it('opens on the newest page, with history going on before it', () => {
    const { window, bodies } = fixture
    expect(bodies()).toEqual(run(85, 99))
    expect([window().hasOlder, window().hasNewer]).toEqual([true, false])
  })

  it('pages older until it reaches the first message', async () => {
    const { store, bob, window, bodies } = fixture

    await store.actions.loadOlder(bob)
    expect(bodies()).toEqual(run(55, 99))
    expect(window().hasOlder).toBe(true)

    await store.actions.loadOlder(bob)
    await store.actions.loadOlder(bob)
    await store.actions.loadOlder(bob)
    expect(bodies()).toEqual(run(0, 99))
    expect(window().hasOlder).toBe(false)

    // Nothing left to read: the window is the conversation's oldest end.
    await store.actions.loadOlder(bob)
    expect(bodies()).toEqual(run(0, 99))
  })

  it('asks for a page once while that page is still out', async () => {
    const { store, client, bob } = fixture
    let reads = 0
    const read = client.getMessages.bind(client)
    client.getMessages = (...args) => {
      reads += 1
      return read(...args)
    }

    await Promise.all([store.actions.loadOlder(bob), store.actions.loadOlder(bob)])

    expect(reads).toBe(1)
  })

  it('takes a message that arrives at its newest end', async () => {
    const { client, bob, bodies } = fixture
    await client.sendMessage(bob, { body: 'late' })
    expect(bodies().at(-1)).toBe('late')
  })
})

describe('a page read that fails', () => {
  it('says the older page failed, and leaves the window free to ask for it again', async () => {
    const { store, client, bob, window, bodies } = await longHistory()
    await store.actions.loadHistory(bob)
    const read = client.getMessages.bind(client)
    client.getMessages = () => Promise.reject(new Error('the database is busy'))

    await expect(store.actions.loadOlder(bob)).resolves.toBeUndefined()
    expect([window().fetchingOlder, window().olderPageFailed]).toEqual([false, true])

    client.getMessages = read
    await store.actions.loadOlder(bob)
    expect(bodies()).toEqual(run(55, 99))
    expect(window().olderPageFailed).toBe(false)
  })

  it('says the first page failed, rather than saying it is still being read', async () => {
    const { store, client, bob, window, bodies } = await longHistory()
    const read = client.getMessages.bind(client)
    client.getMessages = () => Promise.reject(new Error('the database is busy'))

    await expect(store.actions.loadHistory(bob)).resolves.toBeUndefined()
    expect([window().ready, window().fetching, window().firstPageFailed]).toEqual([
      false,
      false,
      true,
    ])

    client.getMessages = read
    await store.actions.loadHistory(bob)
    expect(bodies()).toEqual(run(85, 99))
    expect(window().firstPageFailed).toBe(false)
  })
})

describe('a history-replaced while a read is out', () => {
  it.each([
    ['the first page', (f: Fixture) => f.store.actions.loadHistory(f.bob)],
    ['a page older', (f: Fixture) => f.store.actions.loadOlder(f.bob)],
  ])('drops %s, read before the messages it holds were deleted', async (_read, reads) => {
    const fixture = await longHistory()
    const { store, world, client, bob, window } = fixture
    await store.actions.loadHistory(bob)
    if (_read === 'the first page') store.actions.forgetHistory(bob)
    // Read at once, answered when released: the page predates what happens in between.
    const held: Array<() => void> = []
    const read = client.getMessages.bind(client)
    client.getMessages = (...args): Promise<MessagePage> => {
      const page = read(...args)
      return new Promise((resolve) => held.push(() => resolve(page)))
    }
    const stale = reads(fixture)

    world.account('Alice').clearHistory(bob)
    client.getMessages = read
    await store.actions.loadHistory(bob)
    held[0]?.()
    await stale

    expect(window().messages).toEqual([])
    expect(window().hasOlder).toBe(false)
  })
})

describe('a read that is still out', () => {
  it('lands nowhere once the conversation is left', async () => {
    const { store, client, bob } = await longHistory()
    await store.actions.loadHistory(bob)
    /** Holds every read back until released, in the order they were asked. */
    const held: Array<() => void> = []
    const read = client.getMessages.bind(client)
    client.getMessages = (...args): Promise<MessagePage> =>
      new Promise((resolve, reject) => {
        held.push(() => {
          read(...args).then(resolve, reject)
        })
      })

    const older = store.actions.loadOlder(bob)
    store.actions.forgetHistory(bob)
    held[0]?.()
    await older

    expect(store.getState().histories[bob]).toBeUndefined()
  })
})
