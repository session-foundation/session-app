import { friends, type FakeWorld } from '@session/client/fake'
import type { MessagePage, SessionClient } from '@session/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createSessionStore, type SessionStore } from '#src/store'
import { MAX_JUMPS, type MessageWindow } from '#src/types'

/** Alice's conversation with Bob holding `m0` to `m99`, each a tick after the last. */
const HISTORY = 100

interface Fixture {
  store: SessionStore
  world: FakeWorld
  client: SessionClient
  bob: string
  idOf: (body: string) => number
  window: () => MessageWindow
  bodies: () => string[]
}

async function longHistory(): Promise<Fixture> {
  const { world, clients } = friends(['Alice', 'Bob'])
  const client = clients['Alice']
  if (!client) throw new Error('fixture did not produce a client')
  const bob = world.account('Bob').sessionId
  const ids = new Map<string, number>()
  for (let i = 0; i < HISTORY; i += 1) {
    const body = `m${String(i)}`
    ids.set(body, await client.sendMessage(bob, { body }))
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
    idOf: (body) => {
      const id = ids.get(body)
      if (id === undefined) throw new Error(`${body} was never sent`)
      return id
    },
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

  it('lands on a message it holds without reading anything', async () => {
    const { store, client, bob, idOf, window, bodies } = fixture
    let reads = 0
    const read = client.getMessages.bind(client)
    client.getMessages = (...args) => {
      reads += 1
      return read(...args)
    }

    expect(await store.actions.jumpToMessage(bob, idOf('m90'))).toBe('landed')

    expect(reads).toBe(0)
    expect(bodies()).toEqual(run(85, 99))
    expect(window().landing?.messageId).toBe(idOf('m90'))
  })

  it('replaces the window with one around a message it does not hold', async () => {
    const { store, bob, idOf, window, bodies } = fixture

    expect(await store.actions.jumpToMessage(bob, idOf('m40'))).toBe('landed')

    // The message in the middle: 29 older, itself, and 30 newer.
    expect(bodies()).toEqual(run(11, 70))
    expect([window().hasOlder, window().hasNewer]).toEqual([true, true])
    expect(window().landing?.messageId).toBe(idOf('m40'))
  })

  it('fills the window from the other side near an end of the conversation', async () => {
    const { store, bob, idOf, window, bodies } = fixture
    await store.actions.jumpToMessage(bob, idOf('m3'))
    expect(bodies()).toEqual(run(0, 59))
    expect([window().hasOlder, window().hasNewer]).toEqual([false, true])
  })

  it('gives every landing its own serial, a repeat included', async () => {
    const { store, bob, idOf, window } = fixture
    await store.actions.jumpToMessage(bob, idOf('m80'))
    const first = window().landing?.serial
    await store.actions.jumpToMessage(bob, idOf('m80'))
    expect(window().landing?.serial).not.toBe(first)
  })

  it('pages newer from a jumped window until it reaches the newest message', async () => {
    const { store, bob, idOf, window, bodies } = fixture
    await store.actions.jumpToMessage(bob, idOf('m3'))

    await store.actions.loadNewer(bob)
    expect(bodies()).toEqual(run(0, 89))
    expect(window().hasNewer).toBe(true)

    await store.actions.loadNewer(bob)
    expect(bodies()).toEqual(run(0, 99))
    expect(window().hasNewer).toBe(false)

    // Nothing left to read: the window is the conversation's newest end.
    await store.actions.loadNewer(bob)
    expect(bodies()).toEqual(run(0, 99))
  })

  it('pages older from a jumped window', async () => {
    const { store, bob, idOf, window, bodies } = fixture
    await store.actions.jumpToMessage(bob, idOf('m60'))
    expect(bodies()).toEqual(run(31, 90))

    await store.actions.loadOlder(bob)
    expect(bodies()).toEqual(run(1, 90))
    expect(window().hasOlder).toBe(true)

    await store.actions.loadOlder(bob)
    expect(bodies()).toEqual(run(0, 90))
    expect(window().hasOlder).toBe(false)
  })

  it('asks for a page once while that page is still out', async () => {
    const { store, client, bob, idOf } = fixture
    await store.actions.jumpToMessage(bob, idOf('m40'))
    let reads = 0
    const read = client.getMessages.bind(client)
    client.getMessages = (...args) => {
      reads += 1
      return read(...args)
    }

    await Promise.all([store.actions.loadNewer(bob), store.actions.loadNewer(bob)])
    await Promise.all([store.actions.loadOlder(bob), store.actions.loadOlder(bob)])

    expect(reads).toBe(2)
  })

  it('leaves a message that arrives past a window short of the newest to paging', async () => {
    const { store, world, client, bob, idOf, bodies } = fixture
    await store.actions.jumpToMessage(bob, idOf('m3'))

    await client.sendMessage(bob, { body: 'late' })
    world.settle()
    expect(bodies()).toEqual(run(0, 59))

    await store.actions.loadNewer(bob)
    await store.actions.loadNewer(bob)
    await store.actions.loadNewer(bob)
    expect(bodies()).toEqual([...run(0, 99), 'late'])

    // At the newest end the window takes what arrives.
    await client.sendMessage(bob, { body: 'later' })
    expect(bodies().at(-1)).toBe('later')
  })

  it('goes back to the newest page from a window short of it', async () => {
    const { store, bob, idOf, window, bodies } = fixture
    await store.actions.jumpToMessage(bob, idOf('m3'))

    await store.actions.showNewest(bob)

    expect(bodies()).toEqual(run(85, 99))
    expect([window().hasOlder, window().hasNewer]).toEqual([true, false])
  })

  it('replaces a window that reaches the newest message only when asked to, dropping the pages above', async () => {
    const { store, bob, window, bodies } = fixture
    await store.actions.loadOlder(bob)
    await store.actions.loadOlder(bob)
    expect(bodies()).toEqual(run(25, 99))

    await store.actions.showNewest(bob)
    expect(bodies()).toEqual(run(25, 99))

    await store.actions.showNewest(bob, { evenWhenHeld: true })
    expect(bodies()).toEqual(run(85, 99))
    expect([window().hasOlder, window().hasNewer]).toEqual([true, false])
  })

  it('says a deleted or unknown message is not there, and keeps the window', async () => {
    const { store, client, bob, idOf, window, bodies } = fixture
    await client.deleteMessage(idOf('m40'), 'here')
    const before = window()

    expect(await store.actions.jumpToMessage(bob, idOf('m40'), idOf('m99'))).toBe('absent')
    expect(await store.actions.jumpToMessage(bob, 987_654, idOf('m99'))).toBe('absent')

    expect(bodies()).toEqual(run(85, 99))
    expect(window().jumps).toEqual(before.jumps)
    expect(window().landing).toBeUndefined()
  })

  it.each([
    ['a page newer', (f: Fixture) => f.store.actions.loadNewer(f.bob)],
    ['the newest page', (f: Fixture) => f.store.actions.showNewest(f.bob)],
    ['a jump', (f: Fixture) => f.store.actions.jumpToMessage(f.bob, f.idOf('m99'))],
    [
      'the first page',
      (f: Fixture) => {
        f.store.actions.forgetHistory(f.bob)
        return f.store.actions.loadHistory(f.bob)
      },
    ],
  ])(
    'takes a message stored after %s was read and announced before it landed',
    async (_read, reads) => {
      const { store, client, bob, idOf, window, bodies } = fixture
      await store.actions.jumpToMessage(bob, idOf('m40'))
      const read = client.getMessages.bind(client)
      client.getMessages = async (...args) => {
        const page = await read(...args)
        client.getMessages = read
        await client.sendMessage(bob, { body: 'late' })
        return page
      }

      await reads(fixture)

      expect(window().hasNewer).toBe(false)
      expect(bodies().slice(-3)).toEqual(['m98', 'm99', 'late'])
    },
  )

  it('takes a message stored after a page older was read, timestamped inside that page', async () => {
    const { store, world, client, bob, idOf, bodies } = fixture
    await store.actions.jumpToMessage(bob, idOf('m80'))
    const read = client.getMessages.bind(client)
    client.getMessages = async (...args) => {
      const page = await read(...args)
      client.getMessages = read
      // From a peer that was offline: sent while m20 was, stored only now.
      const at = page.messages.find((m) => m.body === 'm20')?.timestamp ?? 0
      world.account('Alice').deliverFrom(world.account('Bob'), 'late', at)
      return page
    }

    await store.actions.loadOlder(bob)

    expect(bodies().slice(bodies().indexOf('m20'), bodies().indexOf('m20') + 3)).toEqual([
      'm20',
      'late',
      'm21',
    ])
  })

  it('does not land on a message deleted while the window holds it', async () => {
    const { store, client, bob, idOf, window } = fixture
    await client.deleteMessage(idOf('m90'), 'here')
    expect(await store.actions.jumpToMessage(bob, idOf('m90'))).toBe('absent')
    expect(window().landing).toBeUndefined()
  })
})

describe('the way back from a jump', () => {
  let fixture: Fixture
  beforeEach(async () => {
    fixture = await longHistory()
    await fixture.store.actions.loadHistory(fixture.bob)
  })

  it('remembers the reply each jump started from, newest last', async () => {
    const { store, bob, idOf, window } = fixture
    await store.actions.jumpToMessage(bob, idOf('m80'), idOf('m99'))
    await store.actions.jumpToMessage(bob, idOf('m40'), idOf('m80'))
    expect(window().jumps).toEqual([idOf('m99'), idOf('m80')])
  })

  it('remembers nothing for a jump that started from no reply', async () => {
    const { store, bob, idOf, window } = fixture
    await store.actions.jumpToMessage(bob, idOf('m80'))
    expect(window().jumps).toEqual([])
  })

  it('walks back one jump at a time, reading around a reply it no longer holds', async () => {
    const { store, bob, idOf, window, bodies } = fixture
    await store.actions.jumpToMessage(bob, idOf('m80'), idOf('m99'))
    await store.actions.jumpToMessage(bob, idOf('m10'), idOf('m80'))
    expect(bodies()).toEqual(run(0, 59))

    await store.actions.returnFromJump(bob)
    expect(window().landing?.messageId).toBe(idOf('m80'))
    expect(bodies()).toEqual(run(40, 99))
    expect(window().jumps).toEqual([idOf('m99')])

    await store.actions.returnFromJump(bob)
    expect(window().landing?.messageId).toBe(idOf('m99'))
    expect(window().jumps).toEqual([])

    // Nothing left to walk back: the landing stays where it was.
    const landed = window().landing
    await store.actions.returnFromJump(bob)
    expect(window().landing).toBe(landed)
  })

  it('keeps the jump when the read back fails, for the next press', async () => {
    const { store, client, bob, idOf, window } = fixture
    await store.actions.jumpToMessage(bob, idOf('m10'), idOf('m99'))
    const read = client.getMessages.bind(client)
    client.getMessages = () => Promise.reject(new Error('the database is busy'))

    await expect(store.actions.returnFromJump(bob)).rejects.toThrow('busy')
    expect(window().jumps).toEqual([idOf('m99')])

    client.getMessages = read
    await store.actions.returnFromJump(bob)
    expect(window().landing?.messageId).toBe(idOf('m99'))
    expect(window().jumps).toEqual([])
  })

  it('skips a reply deleted since, for the one before it', async () => {
    const { store, client, bob, idOf, window } = fixture
    await store.actions.jumpToMessage(bob, idOf('m90'), idOf('m99'))
    await store.actions.jumpToMessage(bob, idOf('m10'), idOf('m90'))
    await client.deleteMessage(idOf('m90'), 'here')

    await store.actions.returnFromJump(bob)

    expect(window().landing?.messageId).toBe(idOf('m99'))
    expect(window().jumps).toEqual([])
  })

  it('skips a reply deleted since that the window still holds', async () => {
    const { store, client, bob, idOf, window } = fixture
    await store.actions.jumpToMessage(bob, idOf('m90'), idOf('m99'))
    await store.actions.jumpToMessage(bob, idOf('m80'), idOf('m90'))
    await client.deleteMessage(idOf('m90'), 'here')

    await store.actions.returnFromJump(bob)

    expect(window().landing?.messageId).toBe(idOf('m99'))
    expect(window().jumps).toEqual([])
  })

  it(`keeps ${String(MAX_JUMPS)} jumps, dropping the oldest for one more`, async () => {
    const { store, bob, idOf, window } = fixture
    // Each jump starts from the message before it.
    for (let i = 0; i <= MAX_JUMPS; i += 1)
      await store.actions.jumpToMessage(bob, idOf(`m${String(98 - i)}`), idOf(`m${String(99 - i)}`))

    expect(window().jumps.length).toBe(MAX_JUMPS)
    expect(window().jumps[0]).toBe(idOf('m98'))
    expect(window().jumps.at(-1)).toBe(idOf(`m${String(99 - MAX_JUMPS)}`))
  })

  it('forgets the latest jump alone, or every jump, when told the way back is no longer wanted', async () => {
    const { store, bob, idOf, window } = fixture
    await store.actions.jumpToMessage(bob, idOf('m90'), idOf('m99'))
    await store.actions.jumpToMessage(bob, idOf('m80'), idOf('m90'))
    const landed = window().landing

    store.actions.forgetJumps(bob, 'latest')
    expect(window().jumps).toEqual([idOf('m99')])
    store.actions.forgetJumps(bob, 'all')
    expect(window().jumps).toEqual([])

    // Forgetting moves nothing, and with nothing remembered changes nothing.
    expect(window().landing).toBe(landed)
    const before = window()
    store.actions.forgetJumps(bob, 'all')
    expect(window()).toBe(before)
  })

  it('goes with the window when the conversation is left', async () => {
    const { store, bob, idOf, window } = fixture
    await store.actions.jumpToMessage(bob, idOf('m10'), idOf('m99'))
    store.actions.forgetHistory(bob)
    expect(store.getState().histories[bob]).toBeUndefined()

    await store.actions.loadHistory(bob)
    expect(window().jumps).toEqual([])
    expect(window().landing).toBeUndefined()
  })

  it('is emptied by a send, which shows the newest page', async () => {
    const { store, bob, idOf, window, bodies } = fixture
    await store.actions.jumpToMessage(bob, idOf('m10'), idOf('m99'))
    expect(window().hasNewer).toBe(true)

    await store.actions.send(bob, { body: 'answer' })

    expect(window().jumps).toEqual([])
    expect(window().hasNewer).toBe(false)
    expect(bodies().at(-1)).toBe('answer')
    expect(bodies().length).toBe(15)
  })
})

describe('a send from a window short of the newest message', () => {
  it('is not refused when the read of the newest page fails after it is stored', async () => {
    const { store, client, bob, idOf, window } = await longHistory()
    await store.actions.loadHistory(bob)
    await store.actions.jumpToMessage(bob, idOf('m10'), idOf('m99'))
    const read = client.getMessages.bind(client)
    client.getMessages = () => Promise.reject(new Error('the database is busy'))

    await expect(store.actions.send(bob, { body: 'answer' })).resolves.toBeUndefined()

    // Left on the jumped window, from which paging still reaches what was sent.
    expect(window().hasNewer).toBe(true)
    client.getMessages = read
    await store.actions.showNewest(bob)
    expect(window().messages.at(-1)?.body).toBe('answer')
  })
})

describe('a page read that fails', () => {
  it('says the older page failed, and leaves the window free to ask for each page again', async () => {
    const { store, client, bob, idOf, window, bodies } = await longHistory()
    await store.actions.loadHistory(bob)
    await store.actions.jumpToMessage(bob, idOf('m40'))
    const read = client.getMessages.bind(client)
    client.getMessages = () => Promise.reject(new Error('the database is busy'))

    await expect(store.actions.loadOlder(bob)).resolves.toBeUndefined()
    await expect(store.actions.loadNewer(bob)).resolves.toBeUndefined()
    expect([
      window().fetchingOlder,
      window().olderPageFailed,
      window().fetchingNewer,
      window().newerPageFailed,
    ]).toEqual([false, true, false, true])

    client.getMessages = read
    await store.actions.loadOlder(bob)
    await store.actions.loadNewer(bob)
    expect(bodies()).toEqual(run(0, 99))
    expect([window().olderPageFailed, window().newerPageFailed]).toEqual([false, false])
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
  const forget = (f: Fixture) => {
    f.store.actions.forgetHistory(f.bob)
    return Promise.resolve()
  }
  const jumpBack = async (f: Fixture) => {
    await f.store.actions.jumpToMessage(f.bob, f.idOf('m10'))
  }
  const nothing = () => Promise.resolve()
  it.each([
    ['the first page', forget, (f: Fixture) => f.store.actions.loadHistory(f.bob)],
    ['a page older', nothing, (f: Fixture) => f.store.actions.loadOlder(f.bob)],
    ['a page newer', jumpBack, (f: Fixture) => f.store.actions.loadNewer(f.bob)],
    ['the newest page', jumpBack, (f: Fixture) => f.store.actions.showNewest(f.bob)],
    ['a jump', nothing, (f: Fixture) => f.store.actions.jumpToMessage(f.bob, f.idOf('m10'))],
  ])('drops %s, read before the messages it holds were deleted', async (_read, before, reads) => {
    const fixture = await longHistory()
    const { store, world, client, bob, window } = fixture
    await store.actions.loadHistory(bob)
    await before(fixture)
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
    expect([window().hasOlder, window().hasNewer]).toEqual([false, false])
  })
})

describe('a read that is still out', () => {
  let fixture: Fixture
  /** Holds every read back until released, in the order they were asked. */
  let held: Array<() => void>
  beforeEach(async () => {
    fixture = await longHistory()
    await fixture.store.actions.loadHistory(fixture.bob)
    held = []
    const { client } = fixture
    const read = client.getMessages.bind(client)
    client.getMessages = (...args): Promise<MessagePage> =>
      new Promise((resolve, reject) => {
        held.push(() => {
          read(...args).then(resolve, reject)
        })
      })
  })

  it('lands nowhere once the conversation is left', async () => {
    const { store, bob, idOf } = fixture
    const jumping = store.actions.jumpToMessage(bob, idOf('m10'), idOf('m99'))
    store.actions.forgetHistory(bob)
    held[0]?.()

    expect(await jumping).toBe('superseded')
    expect(store.getState().histories[bob]).toBeUndefined()
  })

  it('gives way to a later jump', async () => {
    const { store, bob, idOf, window, bodies } = fixture
    const first = store.actions.jumpToMessage(bob, idOf('m10'), idOf('m99'))
    const second = store.actions.jumpToMessage(bob, idOf('m40'), idOf('m99'))
    held[1]?.()
    expect(await second).toBe('landed')
    held[0]?.()
    // Overtaken, which is not the message being missing.
    expect(await first).toBe('superseded')

    expect(bodies()).toEqual(run(11, 70))
    expect(window().landing?.messageId).toBe(idOf('m40'))
    expect(window().jumps).toEqual([idOf('m99')])
  })

  it('is not joined to a window a jump has replaced since', async () => {
    const { store, bob, idOf, window, bodies } = fixture
    const older = store.actions.loadOlder(bob)
    const jumping = store.actions.jumpToMessage(bob, idOf('m10'))
    held[1]?.()
    await jumping
    held[0]?.()
    await older

    expect(bodies()).toEqual(run(0, 59))
    // The page was dropped, so the window is free to ask for it again.
    expect(window().fetchingOlder).toBe(false)
  })

  it('asks again for the page a jump to nothing cancelled', async () => {
    const { store, bob, window, bodies } = fixture
    const older = store.actions.loadOlder(bob)
    const jumping = store.actions.jumpToMessage(bob, 987_654)
    held[1]?.()
    expect(await jumping).toBe('absent')
    held[0]?.()
    await older

    expect(window().fetchingOlder).toBe(true)
    held[2]?.()
    await vi.waitFor(() => {
      expect(window().fetchingOlder).toBe(false)
    })
    expect(bodies()).toEqual(run(55, 99))
  })

  it.each([
    ['a jump', (f: Fixture) => f.store.actions.jumpToMessage(f.bob, f.idOf('m10'))],
    [
      'a read of the newest page',
      (f: Fixture) => f.store.actions.showNewest(f.bob, { evenWhenHeld: true }),
    ],
  ])('asks again for the page cancelled by %s whose read fails', async (_read, reads) => {
    const { store, client, bob, window, bodies } = fixture
    const older = store.actions.loadOlder(bob)
    const read = client.getMessages.bind(client)
    client.getMessages = () => Promise.reject(new Error('offline'))
    const reading = reads(fixture)
    client.getMessages = read
    await expect(reading).rejects.toThrow('offline')
    held[0]?.()
    await older

    held[1]?.()
    await vi.waitFor(() => {
      expect(window().fetchingOlder).toBe(false)
    })
    expect(bodies()).toEqual(run(55, 99))
  })

  it('does not ask again for a page once a later read has replaced the window', async () => {
    const { store, bob, idOf, window, bodies } = fixture
    const older = store.actions.loadOlder(bob)
    const nothing = store.actions.jumpToMessage(bob, 987_654)
    const jumping = store.actions.jumpToMessage(bob, idOf('m40'))
    held[2]?.()
    await jumping
    held[1]?.()
    expect(await nothing).toBe('superseded')
    held[0]?.()
    await older

    expect(held).toHaveLength(3)
    expect(bodies()).toEqual(run(11, 70))
    expect(window().fetchingOlder).toBe(false)
  })
})
