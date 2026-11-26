import {
  createFakeTransport,
  friends,
  friendsWithAttachments,
  type FakeWorld,
} from '@session/client/fake'
import {
  createKeylessTransport,
  createRefusingTransport,
  createSessionClient,
  keyMissing,
  keyUnavailable,
  SessionClientError,
  type Frame,
  type MessagePage,
  type SessionClient,
} from '@session/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

describe('the network status', () => {
  it('is asked for by hydrate and then followed', async () => {
    const { world, clients } = friends(['Alice', 'Bob'])
    const alice = clients['Alice']
    if (!alice) throw new Error('fixture did not produce a client')
    const store = createSessionStore(alice)

    await store.actions.hydrate()
    // No network attached: the fake, like the bridge, answers disconnected rather than unknown.
    expect(store.getState().networkStatus).toBe('disconnected')

    await alice.attachNetwork({ netid: 'mainnet' })
    // A new Network has not heard from its transport or router yet.
    expect(store.getState().networkStatus).toBe('unknown')
    world.settle()
    expect(store.getState().networkStatus).toBe('connected')
  })

  it('is asked for again on a device left with no account', async () => {
    const { world, clients } = friends(['Alice', 'Bob'])
    const alice = clients['Alice']
    if (!alice) throw new Error('fixture did not produce a client')
    const store = createSessionStore(alice)
    await alice.attachNetwork({ netid: 'mainnet' })
    world.settle()
    await store.actions.hydrate()
    expect(store.getState().networkStatus).toBe('connected')

    // A discard resets the store to empty; the answer after it is what the bridge now says.
    await store.actions.discardAccount()
    expect(store.getState().networkStatus).toBe('disconnected')
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

describe('the switched feature flags', () => {
  function alice() {
    const { world, clients } = friends(['Alice', 'Bob'])
    const client = clients['Alice']
    if (!client) throw new Error('fixture did not produce a client')
    return { world, client, store: createSessionStore(client) }
  }

  it('are none until one is switched', async () => {
    const { store } = alice()
    await store.actions.hydrate()
    expect(store.getState().flagToggles).toEqual({})
  })

  it('are stored against the account and read back with it, and a reset forgets one', async () => {
    const { client, store } = alice()
    await store.actions.hydrate()

    await store.actions.setFlagToggle('disableAnimations', true)
    await store.actions.setFlagToggle('debugMode', false)
    expect(store.getState().flagToggles).toEqual({ disableAnimations: true, debugMode: false })

    await store.actions.setFlagToggle('debugMode', null)
    const next = createSessionStore(client)
    await next.actions.hydrate()
    expect(next.getState().flagToggles).toEqual({ disableAnimations: true })
  })

  it('ignore a stored value that is not an object of switches', async () => {
    const { client, store } = alice()
    await store.actions.hydrate()
    for (const stored of ['not json', '[true]', '{"disableAnimations":"yes","debugMode":true}']) {
      await client.setPref('developer.flagToggles', stored)
      const next = createSessionStore(client)
      await next.actions.hydrate()
      expect(next.getState().flagToggles, stored).toEqual(
        stored.startsWith('{') ? { debugMode: true } : {},
      )
    }
  })

  it('are replaced together in one write, as turning debug mode off does', async () => {
    const { client, store } = alice()
    await store.actions.hydrate()
    await store.actions.setFlagToggle('disableAnimations', true)
    await store.actions.setFlagToggle('forceFastModeAvailable', true)

    await store.actions.replaceFlagToggles({ debugMode: false })
    expect(store.getState().flagToggles).toEqual({ debugMode: false })
    const next = createSessionStore(client)
    await next.actions.hydrate()
    expect(next.getState().flagToggles).toEqual({ debugMode: false })
  })

  it('keep every switch when several are made without waiting for the first to be stored', async () => {
    const { client, store } = alice()
    await store.actions.hydrate()

    await Promise.all([
      store.actions.setFlagToggle('disableAnimations', true),
      store.actions.setFlagToggle('forceFastModeAvailable', true),
      store.actions.setFlagToggle('debugMode', false),
    ])
    const all = { disableAnimations: true, forceFastModeAvailable: true, debugMode: false }
    expect(store.getState().flagToggles).toEqual(all)
    const next = createSessionStore(client)
    await next.actions.hydrate()
    expect(next.getState().flagToggles).toEqual(all)
  })

  it('go with the account', async () => {
    const { world, store } = alice()
    await store.actions.hydrate()
    await store.actions.setFlagToggle('disableAnimations', true)

    world.account('Alice').haveAccount = false
    await store.actions.hydrate()
    expect(store.getState().flagToggles).toEqual({})
  })
})

describe('the recovery password', () => {
  function alice() {
    const { world, clients } = friends(['Alice', 'Bob'])
    const client = clients['Alice']
    if (!client) throw new Error('fixture did not produce a client')
    return { world, client, store: createSessionStore(client) }
  }

  it('is shown until hidden, and stays hidden on the next start', async () => {
    const { client, store } = alice()
    await store.actions.hydrate()
    expect(store.getState().recoveryPasswordHidden).toBe(false)

    await store.actions.hideRecoveryPassword()
    expect(store.getState().recoveryPasswordHidden).toBe(true)

    const next = createSessionStore(client)
    await next.actions.hydrate()
    expect(next.getState().recoveryPasswordHidden).toBe(true)
  })

  it('reaches the caller without passing through the store', async () => {
    const { store } = alice()
    await store.actions.hydrate()
    const before = JSON.stringify(store.getState())

    const { words, seedHex } = await store.actions.getRecoveryPassword()

    expect(words.length).toBeGreaterThan(0)
    expect(seedHex).toMatch(/^(?:[0-9a-f]{32}){1,2}$/)
    expect(JSON.stringify(store.getState())).toBe(before)
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

describe('a start with no bridge behind it', () => {
  it('says a clear cannot help, where a refused start says it can', async () => {
    const refused = createSessionStore(createSessionClient(createRefusingTransport('no module')))
    await refused.actions.start()
    expect(refused.getState().startupError).toMatch(/the bridge could not start: no module/)
    expect(refused.getState().startupFailureKind).toBe('noBridge')

    const { clients } = friends(['Alice', 'Bob'])
    const alice = clients['Alice']
    if (!alice) throw new Error('fixture did not produce a client')
    const store = createSessionStore(alice)
    alice.getAccountInfo = () => Promise.reject(new SessionClientError('file is not a database'))
    await store.actions.start()
    expect(store.getState().startupFailureKind).toBe('unreadable')
  })
})

describe('a start with no database key', () => {
  it('is told apart by its code, and a confirmed clear opens a bridge and starts in place', async () => {
    const { clients } = friends(['Alice', 'Bob'])
    const alice = clients['Alice']
    if (!alice) throw new Error('fixture did not produce a client')
    let cleared = 0
    const transport = createKeylessTransport(keyMissing(), () => {
      cleared += 1
      return Promise.resolve(createFakeTransport(alice))
    })
    const store = createSessionStore(createSessionClient(transport))

    await store.actions.start()
    expect(store.getState().startupError).toBe(keyMissing().message)
    expect(store.getState().startupFailureKind).toBe('unreadable')
    expect(cleared).toBe(0)

    await store.actions.clearDeviceData()
    expect(cleared).toBe(1)
    expect(store.getState().startupError).toBeNull()
    expect(store.getState().hydrated).toBe(true)
  })

  it('calls a key the keychain will not give up now transient', async () => {
    const transport = createKeylessTransport(keyUnavailable('locked'), () =>
      Promise.reject(new Error('unused')),
    )
    const store = createSessionStore(createSessionClient(transport))
    await store.actions.start()
    expect(store.getState().startupFailureKind).toBe('transient')
  })
})

describe('a clear that fails', () => {
  it('shows why, as a start that failed, and rejects', async () => {
    // Pressed on the failure screen, a discard that fails used to dismiss the confirm and leave
    // the old reason up, as though the button did nothing. Rejecting as well is what stops a
    // caller ending the process after a clear that did not happen.
    const { clients } = friends(['Alice', 'Bob'])
    const alice = clients['Alice']
    if (!alice) throw new Error('fixture did not produce a client')
    const store = createSessionStore(alice)
    await store.actions.start()

    alice.discardAccount = () => Promise.reject(new SessionClientError('disk full'))

    await expect(store.actions.clearDeviceData()).rejects.toThrow('disk full')
    expect(store.getState().startupError).toBe('disk full')
    expect(store.getState().startupFailureKind).toBe('transient')
  })
})

describe('clearing the device', () => {
  async function started() {
    const { clients } = friends(['Alice', 'Bob'])
    const alice = clients['Alice']
    if (!alice) throw new Error('fixture did not produce a client')
    // Timers the test fires by hand: this package has no timers of its own.
    const due = new Map<number, () => void>()
    let nextTimer = 0
    const timers = {
      setTimeout: (fn: () => void) => {
        due.set(++nextTimer, fn)
        return nextTimer
      },
      clearTimeout: (id: unknown) => {
        due.delete(id as number)
      },
    }
    const store = createSessionStore(alice, { timers })
    await store.actions.start()
    return { alice, store, fireTimers: () => [...due.values()].forEach((fn) => fn()) }
  }

  it('removes the push subscription first, while the account can still sign for it', async () => {
    const { alice, store } = await started()
    const order: string[] = []
    vi.spyOn(alice, 'clearPushToken').mockImplementation(() => {
      order.push('unsubscribe')
      return Promise.resolve()
    })
    const discard = alice.discardAccount.bind(alice)
    vi.spyOn(alice, 'discardAccount').mockImplementation(() => {
      order.push('discard')
      return discard()
    })
    await store.actions.clearDeviceData()
    expect(order).toEqual(['unsubscribe', 'discard'])
  })

  it('goes on without it when the push server does not answer in time', async () => {
    const { alice, store, fireTimers } = await started()
    vi.spyOn(alice, 'clearPushToken').mockImplementation(() => new Promise(() => {}))
    const discard = vi.spyOn(alice, 'discardAccount')
    const clearing = store.actions.clearDeviceData()
    await Promise.resolve()
    expect(discard).not.toHaveBeenCalled()
    fireTimers()
    await clearing
    expect(discard).toHaveBeenCalledTimes(1)
  })

  it('goes on without it when the unsubscribe fails', async () => {
    const { alice, store } = await started()
    vi.spyOn(alice, 'clearPushToken').mockRejectedValue(new Error('offline'))
    const discard = vi.spyOn(alice, 'discardAccount')
    await store.actions.clearDeviceData()
    expect(discard).toHaveBeenCalledTimes(1)
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

  it('shows a message as a list once asked, and reads the choice back after a reload', async () => {
    const { store, world, bob } = fixture
    const load = async () => {
      const running = store.actions.loadHistory(bob)
      world.settle()
      await running
    }
    const gallery = (id: number) =>
      store.getState().histories[bob]?.messages.find((m) => m.id === id)?.gallery

    await load()
    const album = store.getState().histories[bob]?.messages.find((m) => m.galleryViewable)
    expect(album?.gallery).toBe(true)
    if (!album) return

    expect(await store.actions.setGallery(album.id, false)).toBe(true)
    expect(gallery(album.id)).toBe(false)

    store.actions.forgetHistory(bob)
    await load()
    expect(gallery(album.id)).toBe(false)
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
      await store.actions.send(bob, { body: `m${i}` })
      world.settle()
    }
    await store.actions.loadHistory(bob)
    expect(store.getState().histories[bob]?.hasOlder).toBe(true)

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

    pages[0]?.({ messages: [], hasNewer: false, hasOlder: false })
    await first
    expect(store.getState().histories[bob]?.ready).toBe(false)

    pages[1]?.({ messages: [], hasNewer: false, hasOlder: false })
    await second
    expect(store.getState().histories[bob]?.ready).toBe(true)
  })

  it('sends a message with its files, and shows it uploading them before it is sent', async () => {
    const { store, world, bob } = fixture
    world.writeFile('/disk/notes.txt', 900)
    await store.actions.loadHistory(bob)

    await store.actions.send(bob, {
      body: '',
      attachments: [{ path: '/disk/notes.txt', contentType: 'text/plain' }],
    })
    const sent = () => store.getState().histories[bob]?.messages.at(-1)
    expect(sent()?.sendState).toBe('uploading')
    expect(sent()?.attachments.map((a) => a.filename)).toEqual(['notes.txt'])

    world.settle()
    expect(sent()?.sendState).toBe('sent')
    expect(sent()?.attachments.map((a) => [a.uploaded, a.sizeBytes])).toEqual([[true, 900]])
  })

  it('rejects a send libsession refuses, with nothing shown for it', async () => {
    const { store, world, bob } = fixture
    world.writeFile('/disk/other.txt', 10)
    await store.actions.loadHistory(bob)
    const before = store.getState().histories[bob]?.messages.length

    await expect(
      store.actions.send(bob, { body: 'x', attachments: [{ path: '/disk/missing.txt' }] }),
    ).rejects.toThrow(SessionClientError)
    expect(store.getState().histories[bob]?.messages.length).toBe(before)
  })

  it('leaves the state alone when asked to forget a conversation it never loaded', () => {
    const { store, bob } = fixture
    const before = store.getState()
    store.actions.forgetHistory(bob)
    expect(store.getState()).toBe(before)
  })
})

describe("libsession's log lines", () => {
  it('hands them on as libsession sent them, and keeps them out of state', () => {
    const transport: { deliver?: (frame: Frame) => void } = {}
    const client = createSessionClient({
      send: () => undefined,
      setSink: (sink) => {
        transport.deliver = sink
      },
      close: () => undefined,
    })
    const received: [string, string, string][] = []
    const store = createSessionStore(client, {
      libsessionLog: (level, category, message) => {
        received.push([level, category, message])
      },
    })
    const before = store.getState()

    const message = '[d] [+1.000s] [network:info|network/x.cpp:1] Starting clock resync.\n'
    transport.deliver?.({
      type: 'event',
      event: { type: 'log', level: 'info', category: 'network', message },
    })

    expect(received).toEqual([['info', 'network', message]])
    expect(store.getState()).toBe(before)
  })
})

describe('the conversation lists', () => {
  it('are read again when a placement names a row the store does not hold', async () => {
    const { world, clients } = friends(['Alice', 'Bob'])
    const alice = clients['Alice']
    if (!alice) throw new Error('fixture did not produce a client')
    const account = world.account('Alice')
    const [bob] = await alice.getConversations()
    if (!bob) throw new Error('expected a conversation with Bob')
    account.upsertConversation(
      { ...bob, id: `05${'c'.repeat(64)}`, lastActivity: bob.lastActivity - 1 },
      { announce: false },
    )
    const store = createSessionStore(alice)
    await store.actions.hydrate()
    const order = store.getState().conversations.map((c) => c.id)
    expect(order.length).toBe(2)

    // Placed after a row nobody holds: appended meanwhile, which puts Bob last and wrong.
    account.emit({
      type: 'conversation-updated',
      conversation: bob,
      placement: { from: 'conversations', to: 'conversations', after: 'nobody' },
    })

    await vi.waitFor(() => {
      expect(store.getState().listsOutOfStep.conversations).toBe(false)
      expect(store.getState().conversations.map((c) => c.id)).toEqual(order)
    })
  })
})

describe('the Client closed for the background (iOS)', () => {
  it('puts off a start it cut short, and starts again on the read after the reopen', async () => {
    const { clients } = friends(['Alice', 'Bob'])
    const client = clients['Alice']
    if (!client) throw new Error('fixture did not produce a client')
    const store = createSessionStore(client)
    await client.closeClient(0, 0)

    await store.actions.start()
    expect(store.getState().startupError).toBeNull()
    expect(store.getState().hydrated).toBe(false)

    await client.reopenClient()
    await store.actions.reread()
    expect(store.getState().hydrated).toBe(true)
    expect(store.getState().conversations.length).toBeGreaterThan(0)
  })

  it('joins a start still under way rather than starting again beside it', async () => {
    const { clients } = friends(['Alice', 'Bob'])
    const client = clients['Alice']
    if (!client) throw new Error('fixture did not produce a client')
    const store = createSessionStore(client)
    const asked = vi.spyOn(client, 'getAccountInfo')

    await Promise.all([store.actions.start(), store.actions.reread()])

    expect(asked).toHaveBeenCalledTimes(1)
    expect(store.getState().hydrated).toBe(true)
  })

  it('merges what was stored unannounced into a loaded window, keeping what it holds', async () => {
    const { store, client, bob } = seeded()
    await store.actions.hydrate()
    await store.actions.loadHistory(bob)
    const before = store.getState().histories[bob]?.messages ?? []
    const newest = before.at(-1)
    if (newest === undefined) throw new Error('expected a loaded window')

    // What the notification extension stored while the Client was closed: in the database, and
    // never announced to this one.
    const stored = { ...newest, id: newest.id + 1000, timestamp: newest.timestamp + 1, body: 'x' }
    const read = client.getMessages.bind(client)
    vi.spyOn(client, 'getMessages').mockImplementation(async (id, options) => {
      const page = await read(id, options)
      return { ...page, messages: [...page.messages, stored] }
    })

    await store.actions.reread()

    const after = store.getState().histories[bob]?.messages ?? []
    expect(after.map((m) => m.id)).toEqual([...before.map((m) => m.id), stored.id])
  })

  it('takes the newest page as the window when more was stored than a page holds', async () => {
    const { store, client, bob } = seeded()
    await store.actions.hydrate()
    await store.actions.loadHistory(bob)
    const newest = store.getState().histories[bob]?.messages.at(-1)
    if (newest === undefined) throw new Error('expected a loaded window')

    // A page of what the extension stored, with more of it before the page than after the window.
    const stored = [1, 2, 3].map((n) => ({
      ...newest,
      id: newest.id + 1000 + n,
      timestamp: newest.timestamp + 10 + n,
    }))
    vi.spyOn(client, 'getMessages').mockResolvedValue({
      messages: stored,
      hasOlder: true,
      hasNewer: false,
    })

    await store.actions.reread()

    const window = store.getState().histories[bob]
    expect(window?.messages.map((m) => m.id)).toEqual(stored.map((m) => m.id))
    expect(window?.hasOlder).toBe(true)
  })

  it('takes the newest page as the window when the window it finds is empty', async () => {
    const { store, client, bob } = seeded()
    await store.actions.hydrate()
    await store.actions.loadHistory(bob)
    const newest = store.getState().histories[bob]?.messages.at(-1)
    if (newest === undefined) throw new Error('expected a loaded window')
    // A conversation with no messages on screen: nothing held, and nothing either side.
    store.setState((state) => {
      const window = state.histories[bob]
      if (window === undefined) throw new Error('expected a window')
      return {
        histories: {
          ...state.histories,
          [bob]: { ...window, messages: [], hasOlder: false, hasNewer: false },
        },
      }
    })
    vi.spyOn(client, 'getMessages').mockResolvedValue({
      messages: [newest],
      hasOlder: true,
      hasNewer: false,
    })

    await store.actions.reread()

    expect(store.getState().histories[bob]?.hasOlder).toBe(true)
  })

  it('lets a jump still out land after it takes the newest page as the window', async () => {
    // Back by tapping the notification for one of many stored messages: the jump starts first.
    const { store, client, bob } = seeded()
    await store.actions.hydrate()
    await store.actions.loadHistory(bob)
    const newest = store.getState().histories[bob]?.messages.at(-1)
    if (newest === undefined) throw new Error('expected a loaded window')
    const tapped = { ...newest, id: newest.id + 2000, timestamp: newest.timestamp + 5 }
    const stored = { ...newest, id: newest.id + 3000, timestamp: newest.timestamp + 50 }
    let answerJump: (page: MessagePage) => void = () => {}
    vi.spyOn(client, 'getMessages').mockImplementation((_id, options) =>
      options?.around === undefined
        ? Promise.resolve({ messages: [stored], hasOlder: true, hasNewer: false })
        : new Promise((resolve) => {
            answerJump = resolve
          }),
    )

    const jump = store.actions.jumpToMessage(bob, tapped.id)
    await store.actions.reread()
    answerJump({ messages: [tapped], hasOlder: true, hasNewer: true })

    await expect(jump).resolves.toBe('landed')
    expect(store.getState().histories[bob]?.messages.map((m) => m.id)).toEqual([tapped.id])
  })

  it('drops an older page still out when it takes the newest page as the window', async () => {
    const { store, client, bob } = seeded()
    await store.actions.hydrate()
    await store.actions.loadHistory(bob)
    const before = store.getState().histories[bob]?.messages ?? []
    const newest = before.at(-1)
    if (newest === undefined) throw new Error('expected a loaded window')
    store.setState((state) => {
      const window = state.histories[bob]
      if (window === undefined) throw new Error('expected a window')
      return { histories: { ...state.histories, [bob]: { ...window, hasOlder: true } } }
    })
    const stored = { ...newest, id: newest.id + 1000, timestamp: newest.timestamp + 10 }
    let answerOlder: (page: MessagePage) => void = () => {}
    vi.spyOn(client, 'getMessages').mockImplementation((_id, options) =>
      options?.before === undefined
        ? Promise.resolve({ messages: [stored], hasOlder: true, hasNewer: false })
        : new Promise((resolve) => {
            answerOlder = resolve
          }),
    )

    const older = store.actions.loadOlder(bob)
    await store.actions.reread()
    answerOlder({
      messages: [{ ...newest, id: newest.id - 5000 }],
      hasOlder: true,
      hasNewer: false,
    })
    await older

    expect(store.getState().histories[bob]?.messages.map((m) => m.id)).toEqual([stored.id])
  })
})
