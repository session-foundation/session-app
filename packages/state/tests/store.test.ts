import { friends, friendsWithAttachments, type FakeWorld } from '@session/client/fake'
import { SessionClientError, type MessagePage, type SessionClient } from '@session/client'
import { beforeEach, describe, expect, it } from 'vitest'

import { createSessionStore, type SessionStore } from '#src/store'

/**
 * The store's own behaviour, as opposed to the projection's.
 *
 * `applyEvent` is pure and tested by replaying events; what is here is the part that talks to a
 * client - what a window load asks for, and what is thrown away when a screen stops showing one.
 */
function seeded(): { store: SessionStore; world: FakeWorld; client: SessionClient; bob: string } {
  const { world, clients } = friendsWithAttachments(['Alice', 'Bob'])
  const client = clients['Alice']
  if (!client) throw new Error('fixture did not produce a client')
  return { store: createSessionStore(client), world, client, bob: world.account('Bob').sessionId }
}
describe('hydrating a device that has no account', () => {
  it('clears what the previous account left in memory', async () => {
    // The case onboarding creates: somebody backs out of restoring one account to restore another,
    // the database is deleted and the client is rebuilt. libsession then has nothing -- but the
    // store is the same object it always was, and `setState` merges, so an account-shaped update
    // leaves the previous account's conversations sitting in memory behind the new one.
    const { world, clients } = friends(['Alice', 'Bob'])
    const alice = clients['Alice']
    if (!alice) throw new Error('fixture did not produce a client')
    const store = createSessionStore(alice)

    await store.actions.hydrate()
    expect(store.getState().conversations.length).toBeGreaterThan(0)

    // Now the account goes, the way a discard leaves it.
    world.account('Alice').haveAccount = false
    await store.actions.hydrate()

    const after = store.getState()
    expect(after.account?.haveAccount).toBe(false)
    expect(after.conversations).toEqual([])
    expect(after.requests).toEqual([])
    expect(after.histories).toEqual({})
    // Still hydrated: the question was asked and answered, and the answer was "nothing".
    expect(after.hydrated).toBe(true)
  })
})

describe("the account's theme", () => {
  function alice() {
    const { world, clients } = friends(['Alice', 'Bob'])
    const client = clients['Alice']
    if (!client) throw new Error('fixture did not produce a client')
    return { world, client, store: createSessionStore(client) }
  }

  it('is none until the account has chosen one', async () => {
    const { store } = alice()
    await store.actions.hydrate()
    expect(store.getState().appearance).toBeNull()
  })

  it('is stored against the account and read back with it', async () => {
    const { client, store } = alice()
    await store.actions.hydrate()

    await store.actions.setAppearance({ theme: 'ocean-light', accent: 'blue' })
    expect(store.getState().appearance).toEqual({ theme: 'ocean-light', accent: 'blue' })

    const next = createSessionStore(client)
    await next.actions.hydrate()
    expect(next.getState().appearance).toEqual({ theme: 'ocean-light', accent: 'blue' })
  })

  it('goes with the account', async () => {
    // A theme is the account's: one left on a cleared device could tie it back to the account.
    const { world, store } = alice()
    await store.actions.hydrate()
    await store.actions.setAppearance({ theme: 'ocean-light', accent: 'blue' })

    world.account('Alice').haveAccount = false
    await store.actions.hydrate()
    expect(store.getState().appearance).toBeNull()
  })
})

describe('hydrating with a cache limit', () => {
  it('hands the limit to libsession', async () => {
    const { clients } = friends(['Alice', 'Bob'])
    const alice = clients['Alice']
    if (!alice) throw new Error('fixture did not produce a client')
    const store = createSessionStore(alice, { attachmentCacheLimitBytes: 500_000_000 })

    await store.actions.hydrate()

    expect(await alice.getAttachmentCacheLimit()).toBe(500_000_000)
  })

  it('reads the limit back beside what the cache holds', async () => {
    const { clients } = friends(['Alice', 'Bob'])
    const alice = clients['Alice']
    if (!alice) throw new Error('fixture did not produce a client')
    const store = createSessionStore(alice, { attachmentCacheLimitBytes: 500_000_000 })
    await store.actions.hydrate()

    expect(await store.actions.getCacheSettings()).toEqual({
      cacheDir: '',
      limitBytes: 500_000_000,
      usageBytes: 0,
    })
  })
})

describe('a start that fails', () => {
  it('ends in an error rather than in a wait that never finishes', async () => {
    // The launch screen renders while `hydrated` is false, and a rejection used to leave it false
    // for ever with nobody holding the promise -- indistinguishable from a database still
    // migrating, which is the shape the bug took on a device. A failure has to be an outcome.
    const { clients } = friends(['Alice', 'Bob'])
    const alice = clients['Alice']
    if (!alice) throw new Error('fixture did not produce a client')
    const store = createSessionStore(alice)

    // Shadowed on the instance rather than spread into a copy: the fake's methods live on its
    // prototype, so a spread produces an object with none of them.
    alice.getAccountInfo = () =>
      Promise.reject(new SessionClientError('markRead: Invalid conversation id'))

    // Resolves. `start` is the one action that turns a failure into state instead of throwing,
    // because its caller is an app's root and has nowhere to put a rejection.
    await expect(store.actions.start()).resolves.toBeUndefined()

    expect(store.getState().startupError).toBe('markRead: Invalid conversation id')
    expect(store.getState().hydrated).toBe(false)
  })

  it('clears the error when a start is tried again', async () => {
    const { clients } = friends(['Alice', 'Bob'])
    const alice = clients['Alice']
    if (!alice) throw new Error('fixture did not produce a client')
    const store = createSessionStore(alice)
    const real = alice.getAccountInfo.bind(alice)

    alice.getAccountInfo = () => Promise.reject(new SessionClientError('nope'))
    await store.actions.start()
    expect(store.getState().startupError).toBe('nope')

    alice.getAccountInfo = real
    await store.actions.start()
    expect(store.getState().startupError).toBeNull()
    expect(store.getState().hydrated).toBe(true)
  })
})

describe('the store', () => {
  let fixture: ReturnType<typeof seeded>

  beforeEach(() => {
    fixture = seeded()
  })

  it('learns what a pages attachments are doing without waiting for a report', async () => {
    const { store, world, bob } = fixture
    const load = async () => {
      const running = store.actions.loadHistory(bob)
      world.settle()
      await running
    }
    const attachment = (id: number) =>
      store.getState().histories[bob]?.messages.find((m) => m.id === id)?.attachments[0]

    await load()
    const withOne = store.getState().histories[bob]?.messages.find((m) => m.attachments.length > 0)
    expect(withOne).toBeDefined()
    if (!withOne) return

    // Nothing has been fetched, so the next call would start a download. Said by the attachment
    // rather than by a transfers entry: there is no transfer, and `absent` is not the absence of
    // an answer.
    expect(attachment(withOne.id)?.availability).toBe('absent')

    const downloading = store.actions.downloadAttachment({ messageId: withOne.id, index: 0 })
    world.settle()
    await downloading

    // Reloaded from nothing, the way a screen coming back to a conversation does. The page says
    // the file is here, which no event would ever announce.
    store.actions.forgetHistory(bob)
    await load()

    expect(attachment(withOne.id)?.availability).toBe('cached')
  })

  it('drops a conversations window and its transfers when a screen stops showing it', async () => {
    const { store, world, bob } = fixture
    const running = store.actions.loadHistory(bob)
    world.settle()
    await running

    const withOne = store.getState().histories[bob]?.messages.find((m) => m.attachments.length > 0)
    if (!withOne) throw new Error('fixture did not seed an attachment')

    const downloading = store.actions.downloadAttachment({ messageId: withOne.id, index: 0 })
    world.settle()
    await downloading
    expect(Object.keys(store.getState().transfers).length).toBeGreaterThan(0)

    store.actions.forgetHistory(bob)

    // Both, together: a window that outlived its screen was a leak, and the transfers hanging off
    // it were records nothing could draw.
    expect(store.getState().histories[bob]).toBeUndefined()
    expect(Object.keys(store.getState().transfers)).toEqual([])
  })

  it('does not bring back a window forgotten while its first page was in flight', async () => {
    const { store, bob } = fixture
    const loading = store.actions.loadHistory(bob)
    store.actions.forgetHistory(bob)
    await loading

    expect(store.getState().histories[bob]).toBeUndefined()
  })

  it('does not bring back a window forgotten while an older page was in flight', async () => {
    const { store, world, bob } = fixture
    for (let i = 0; i < 40; i += 1) {
      await store.actions.send(bob, `m${i}`)
      world.settle()
    }
    await store.actions.loadHistory(bob)
    expect(store.getState().histories[bob]?.exhausted).toBe(false)

    const older = store.actions.loadOlder(bob)
    store.actions.forgetHistory(bob)
    await older

    expect(store.getState().histories[bob]).toBeUndefined()
  })

  it('keeps only the newest load when a window is forgotten and loaded again', async () => {
    // StrictMode's mount, cleanup, mount: the first page lands after the second load started.
    const { store, client, bob } = fixture
    const pages: Array<(page: MessagePage) => void> = []
    client.getMessages = () => new Promise((resolve) => pages.push(resolve))

    const first = store.actions.loadHistory(bob)
    store.actions.forgetHistory(bob)
    const second = store.actions.loadHistory(bob)

    pages[0]?.({ messages: [] })
    await first
    expect(store.getState().histories[bob]?.ready).toBe(false)

    pages[1]?.({ messages: [] })
    await second
    expect(store.getState().histories[bob]?.ready).toBe(true)
  })

  it('leaves the state alone when asked to forget a conversation it never loaded', () => {
    const { store, bob } = fixture
    const before = store.getState()
    store.actions.forgetHistory(bob)
    expect(store.getState()).toBe(before)
  })
})
