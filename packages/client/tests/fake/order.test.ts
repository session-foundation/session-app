import type { ListPlacement, SessionEvent } from '@session/bridge-types'
import { describe, expect, it } from 'vitest'

import { friends, strangers } from '#src/fake/fixtures'

/**
 * Where the fake says a row belongs, as libsession does.
 *
 * Every change to a list reaches a per-row event carrying its placement: the list the row belongs
 * in and the row it now follows. A new message, a pin, a hide and an approval alike, so a
 * subscriber that read the lists once and applies these in order needs nothing else.
 */
function watch(client: { onEvent: (listener: (event: SessionEvent) => void) => () => void }): {
  events: SessionEvent[]
  types: () => string
  stop: () => void
} {
  const events: SessionEvent[] = []
  const stop = client.onEvent((event) => events.push(event))
  return { events, types: () => `saw: ${events.map((e) => e.type).join(', ')}`, stop }
}

function lastPlacement(events: SessionEvent[]): ListPlacement | undefined {
  return events
    .flatMap((e) =>
      e.type === 'conversation-added' || e.type === 'conversation-updated' ? [e.placement] : [],
    )
    .at(-1)
}

describe('the fake places every change to a list', () => {
  it('places a conversation with a new message first', async () => {
    const { world, clients } = friends(['Alice', 'Bob'])
    const alice = clients['Alice']
    const bob = clients['Bob']
    if (!alice || !bob) throw new Error('fixture did not produce both clients')

    const seen = watch(alice)
    await bob.sendMessage(world.account('Alice').sessionId, { body: 'hello' })
    world.settle()
    seen.stop()

    // `from` is none: the fixture's rows were never reported, as one the app read for itself is
    // not. No `after`, because nothing sorts before the newest activity.
    expect(lastPlacement(seen.events), seen.types()).toEqual({ from: 'none', to: 'conversations' })
  })

  it('places a request in the request list', async () => {
    const { world, clients } = strangers(['Alice', 'Bob'])
    const alice = clients['Alice']
    const bob = clients['Bob']
    if (!alice || !bob) throw new Error('fixture did not produce both clients')

    const seen = watch(alice)
    await bob.sendMessage(world.account('Alice').sessionId, { body: 'let me in again' })
    world.settle()
    seen.stop()

    expect(lastPlacement(seen.events)?.to, seen.types()).toBe('requests')
  })

  it('moves an approved row across in one placement', async () => {
    const { world, clients } = strangers(['Alice', 'Bob'])
    const alice = clients['Alice']
    if (!alice) throw new Error('fixture did not produce a client')

    const [request] = await alice.getMessageRequests()
    if (!request) throw new Error('expected a request to approve')
    // Reported once, so there is a list it was last reported in.
    await alice.markRead(request.id)

    const seen = watch(alice)
    await alice.approveConversation(request.id)
    world.settle()
    seen.stop()

    expect(lastPlacement(seen.events), seen.types()).toEqual({
      from: 'requests',
      to: 'conversations',
    })
  })

  it('places a pinned row at the top and a hidden one nowhere', async () => {
    const { world, clients } = friends(['Alice', 'Bob'])
    const alice = clients['Alice']
    if (!alice) throw new Error('fixture did not produce a client')
    const [conversation] = await alice.getConversations()
    if (!conversation) throw new Error('expected a conversation')

    const pinned = watch(alice)
    await alice.setPriority(conversation.id, 1)
    world.settle()
    pinned.stop()
    expect(pinned.types()).toBe('saw: conversation-updated')
    expect(lastPlacement(pinned.events), pinned.types()).toEqual({
      from: 'none',
      to: 'conversations',
    })

    const hidden = watch(alice)
    await alice.setPriority(conversation.id, -1)
    world.settle()
    hidden.stop()
    expect(lastPlacement(hidden.events), hidden.types()).toEqual({
      from: 'conversations',
      to: 'none',
    })
    expect(await alice.getConversations()).toEqual([])
  })

  it('names the list a removed row was in', async () => {
    const { world, clients } = friends(['Alice', 'Bob'])
    const alice = clients['Alice']
    if (!alice) throw new Error('fixture did not produce a client')
    const [conversation] = await alice.getConversations()
    if (!conversation) throw new Error('expected a conversation')

    // A pin announces the row, so the subscriber is holding it in a list.
    await alice.setPriority(conversation.id, 1)
    world.settle()
    const seen = watch(alice)
    await alice.deleteConversation(conversation.id)
    world.settle()
    seen.stop()

    expect(seen.types()).toBe('saw: conversation-removed')
    const removal = seen.events[0]
    expect(removal?.type === 'conversation-removed' && removal.list).toBe('conversations')
  })

  it('names no list for a removed row it never announced', async () => {
    const { world, clients } = friends(['Alice', 'Bob'])
    const alice = clients['Alice']
    if (!alice) throw new Error('fixture did not produce a client')
    const [conversation] = await alice.getConversations()
    if (!conversation) throw new Error('expected a conversation')

    const seen = watch(alice)
    await alice.deleteConversation(conversation.id)
    world.settle()
    seen.stop()

    expect(seen.types()).toBe('saw: conversation-removed')
    const removal = seen.events[0]
    expect(removal?.type === 'conversation-removed' && removal.list).toBe('none')
  })
})
