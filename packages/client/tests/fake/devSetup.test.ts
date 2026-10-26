import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { backlog } from '#src/fake/backlog'
import {
  driveFakeClock,
  FAKE_TICK_MS,
  pickFakeFixture,
  startDevFake,
  type DevPhotos,
} from '#src/fake/devSetup'
import { photoFileName, photoFileNames } from '#src/fake/media'
import { noDatabaseOpen } from '#src/fake/unopenable'

afterEach(() => {
  vi.useRealTimers()
})

describe('the world a dev fake starts in', () => {
  it('is the two friends with attachments when nothing is set', () => {
    expect(pickFakeFixture({}).fixture).toBe('friends')
  })

  it('is the one EXPO_PUBLIC_SESSION_FAKE_FIXTURE names', () => {
    expect(pickFakeFixture({ EXPO_PUBLIC_SESSION_FAKE_FIXTURE: 'backlog' }).fixture).toBe('backlog')
    expect(pickFakeFixture({ EXPO_PUBLIC_SESSION_FAKE_FIXTURE: 'showcase' }).fixture).toBe(
      'showcase',
    )
  })

  it('still answers the older no-account and rows switches, and crowd from its size alone', () => {
    expect(pickFakeFixture({ EXPO_PUBLIC_SESSION_NO_ACCOUNT: '1' }).fixture).toBe('newcomer')
    expect(pickFakeFixture({ EXPO_PUBLIC_SESSION_FAKE_CROWD_PEERS: '3' }).fixture).toBe('crowd')
    expect(pickFakeFixture({ EXPO_PUBLIC_SESSION_FAKE_ROWS: '1' }).fixture).toBe('rows')
  })

  it('treats an empty value as unset', () => {
    expect(
      pickFakeFixture({
        EXPO_PUBLIC_SESSION_FAKE_FIXTURE: '',
        EXPO_PUBLIC_SESSION_NO_ACCOUNT: '',
        EXPO_PUBLIC_SESSION_FAKE_CROWD_PEERS: '',
        EXPO_PUBLIC_SESSION_FAKE_CROWD_HISTORY: '',
      }).fixture,
    ).toBe('friends')
  })

  it('sizes crowd from both knobs', async () => {
    const { clients } = pickFakeFixture({
      EXPO_PUBLIC_SESSION_FAKE_FIXTURE: 'crowd',
      EXPO_PUBLIC_SESSION_FAKE_CROWD_PEERS: '3',
      EXPO_PUBLIC_SESSION_FAKE_CROWD_HISTORY: '2',
    })
    const alice = clients['Alice']
    if (!alice) throw new Error('no Alice')
    const conversations = await alice.getConversations()
    expect(conversations).toHaveLength(3)
    const [first] = conversations
    if (!first) throw new Error('no conversation')
    const { messages } = await alice.getMessages(first.id, { limit: 100 })
    expect(messages).toHaveLength(2)
  })

  it('refuses a name that is not a fixture, rather than opening another world', () => {
    expect(() => pickFakeFixture({ EXPO_PUBLIC_SESSION_FAKE_FIXTURE: 'showcse' })).toThrow(
      /not a fixture/,
    )
  })

  it('refuses a size that is not a count, rather than a world of NaN peers', () => {
    expect(() => pickFakeFixture({ EXPO_PUBLIC_SESSION_FAKE_CROWD_PEERS: 'ten' })).toThrow(
      /EXPO_PUBLIC_SESSION_FAKE_CROWD_PEERS=ten is not a positive whole number/,
    )
    expect(() => pickFakeFixture({ EXPO_PUBLIC_SESSION_FAKE_CROWD_PEERS: '0' })).toThrow(
      /not a positive whole number/,
    )
    expect(() =>
      pickFakeFixture({
        EXPO_PUBLIC_SESSION_FAKE_FIXTURE: 'crowd',
        EXPO_PUBLIC_SESSION_FAKE_CROWD_HISTORY: '1.5',
      }),
    ).toThrow(/EXPO_PUBLIC_SESSION_FAKE_CROWD_HISTORY=1.5 is not a positive whole number/)
  })
})

describe('the backlog fixture', () => {
  it('holds many conversations of attachments, none of them downloaded', async () => {
    const { world, clients } = backlog()
    const alice = clients['Alice']
    if (!alice) throw new Error('no Alice')
    const conversations = await alice.getConversations()
    expect(conversations.length).toBeGreaterThanOrEqual(7)

    let withAttachments = 0
    for (const conversation of conversations) {
      const { messages } = await alice.getMessages(conversation.id, { limit: 100 })
      for (const message of messages) {
        if (message.attachments.length === 0) continue
        withAttachments += 1
        for (const attachment of message.attachments) {
          expect(['absent', 'notFound']).toContain(attachment.availability)
        }
      }
    }
    expect(withAttachments).toBeGreaterThanOrEqual(100)
    expect(world.now()).toBeGreaterThan(0)
  })
})

describe('the fake photographs', () => {
  it('are thirty, one per ThumbHash', () => {
    expect(photoFileNames()).toHaveLength(30)
    expect(photoFileNames()[0]).toBe('unsplash-01.jpg')
  })

  it('give every picture one, and nothing to a file', async () => {
    const { world, clients } = backlog()
    const alice = clients['Alice']
    if (!alice) throw new Error('no Alice')
    const [conversation] = await alice.getConversations()
    if (!conversation) throw new Error('no conversation')
    const { messages } = await alice.getMessages(conversation.id, { limit: 100 })
    for (const message of messages) {
      for (const attachment of message.attachments) {
        const photo = photoFileName(alice, { messageId: message.id, index: attachment.index })
        const picture = /^(image|video)\//.test(attachment.contentType ?? '')
        expect(photo === null).toBe(!picture)
      }
    }
    expect(world).toBeDefined()
  })
})

describe('the dev clock', () => {
  it('drains the queue each tick when not slowed', () => {
    vi.useFakeTimers()
    const settle = vi.fn()
    const advance = vi.fn()
    const stop = driveFakeClock({ settle, advance } as never, undefined)
    vi.advanceTimersByTime(FAKE_TICK_MS)
    expect(settle).toHaveBeenCalledOnce()
    expect(advance).not.toHaveBeenCalled()
    stop()
  })

  it('advances a slice of each tick when EXPO_PUBLIC_SESSION_FAKE_SLOWDOWN is set', () => {
    vi.useFakeTimers()
    const settle = vi.fn()
    const advance = vi.fn()
    const stop = driveFakeClock({ settle, advance } as never, '10')
    vi.advanceTimersByTime(FAKE_TICK_MS)
    expect(advance).toHaveBeenCalledWith(FAKE_TICK_MS / 10)
    expect(settle).not.toHaveBeenCalled()
    stop()
  })

  it('refuses a slowdown that is not a count, rather than running at full speed', () => {
    const world = { settle: vi.fn(), advance: vi.fn() } as never
    expect(() => driveFakeClock(world, '1O')).toThrow(
      /EXPO_PUBLIC_SESSION_FAKE_SLOWDOWN=1O is not a positive whole number/,
    )
    expect(() => driveFakeClock(world, '0.5')).toThrow(/not a positive whole number/)
  })
})

describe('starting a dev fake', () => {
  const allPhotos: DevPhotos = { has: () => true, where: 'in /photos', fix: 'fetch them' }

  // startDevFake starts a clock it does not hand back; a fake timer keeps it out of the worker.
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('refuses without every photograph, saying where and what to run', () => {
    const [first] = photoFileNames()
    expect(() => startDevFake({}, { ...allPhotos, has: (fileName) => fileName !== first })).toThrow(
      'The fake needs its dev photographs in /photos, and 1 are missing. Run: fetch them',
    )
  })

  it('checks the photographs before anything else', () => {
    expect(() =>
      startDevFake(
        { EXPO_PUBLIC_SESSION_FAKE_FIXTURE: 'showcse' },
        { ...allPhotos, has: () => false },
      ),
    ).toThrow(/60 are missing/)
  })

  it('refuses without the thumbnails made of them, which an older fetch did not write', () => {
    expect(() =>
      startDevFake({}, { ...allPhotos, has: (fileName) => !fileName.startsWith('thumbnail-') }),
    ).toThrow(/30 are missing/)
  })

  it('opens the world the environment names, as Alice, and serves her', async () => {
    const { alice, served } = startDevFake(
      { EXPO_PUBLIC_SESSION_FAKE_FIXTURE: 'backlog' },
      allPhotos,
    )
    expect(served).toBe(alice)
    expect((await alice.getConversations()).length).toBeGreaterThanOrEqual(7)
  })

  it('runs the clock at EXPO_PUBLIC_SESSION_FAKE_SLOWDOWN', () => {
    const { world } = startDevFake({ EXPO_PUBLIC_SESSION_FAKE_SLOWDOWN: '10' }, allPhotos)
    const before = world.now()
    vi.advanceTimersByTime(FAKE_TICK_MS)
    expect(world.now()).toBe(before + FAKE_TICK_MS / 10)
  })

  it('serves a database that will not open on EXPO_PUBLIC_SESSION_FAKE_FAILED_START=1', async () => {
    const { alice, served } = startDevFake(
      { EXPO_PUBLIC_SESSION_FAKE_FAILED_START: '1' },
      allPhotos,
    )
    await expect(served.getConversations()).rejects.toThrow(
      noDatabaseOpen('file is not a database'),
    )
    await expect(alice.getConversations()).resolves.toBeDefined()
  })
})
