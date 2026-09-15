import { friends, type FakeWorld } from '@session/client/fake'
import type { SessionClient } from '@session/client'
import { beforeEach, describe, expect, it } from 'vitest'

import { createSessionStore, type SessionStore } from '#src/store'
import { transferKey } from '#src/types'

/**
 * The store's own behaviour, as opposed to the projection's.
 *
 * `applyEvent` is pure and tested by replaying events; what is here is the part that talks to a
 * client - what a window load asks for, and what is thrown away when a screen stops showing one.
 */
function seeded(): { store: SessionStore; world: FakeWorld; client: SessionClient; bob: string } {
  const { world, clients } = friends(['Alice', 'Bob'])
  const client = clients['Alice']
  if (!client) throw new Error('fixture did not produce a client')
  return { store: createSessionStore(client), world, client, bob: world.account('Bob').sessionId }
}

describe('the store', () => {
  let fixture: ReturnType<typeof seeded>

  beforeEach(() => {
    fixture = seeded()
  })

  it('learns what a pages attachments are doing without waiting for a report', async () => {
    const { store, world, bob } = fixture
    const running = store.actions.loadHistory(bob)
    world.settle()
    await running

    const withOne = store
      .getState()
      .histories[bob]?.messages.find((m) => m.attachments.length > 0)
    expect(withOne).toBeDefined()
    if (!withOne) return

    // Nothing has been fetched, so there is nothing to record: an entry here would claim to know
    // something the row learns better from its absence.
    expect(store.getState().transfers[transferKey('download', withOne.id, 0)]).toBeUndefined()

    const downloading = store.actions.downloadAttachment(withOne.id, 0)
    world.settle()
    await downloading

    // Reloaded from nothing, the way a screen coming back to a conversation does. The page says
    // the file is here, which no event would ever announce.
    store.actions.forgetHistory(bob)
    const again = store.actions.loadHistory(bob)
    world.settle()
    await again

    expect(store.getState().transfers[transferKey('download', withOne.id, 0)]?.state).toBe('done')
  })

  it('drops a conversations window and its transfers when a screen stops showing it', async () => {
    const { store, world, bob } = fixture
    const running = store.actions.loadHistory(bob)
    world.settle()
    await running

    const withOne = store
      .getState()
      .histories[bob]?.messages.find((m) => m.attachments.length > 0)
    if (!withOne) throw new Error('fixture did not seed an attachment')

    const downloading = store.actions.downloadAttachment(withOne.id, 0)
    world.settle()
    await downloading
    expect(Object.keys(store.getState().transfers).length).toBeGreaterThan(0)

    store.actions.forgetHistory(bob)

    // Both, together: a window that outlived its screen was a leak, and the transfers hanging off
    // it were records nothing could draw.
    expect(store.getState().histories[bob]).toBeUndefined()
    expect(Object.keys(store.getState().transfers)).toEqual([])
  })

  it('leaves the state alone when asked to forget a conversation it never loaded', () => {
    const { store, bob } = fixture
    const before = store.getState()
    store.actions.forgetHistory(bob)
    expect(store.getState()).toBe(before)
  })
})
