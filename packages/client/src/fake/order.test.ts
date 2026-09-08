import { describe, expect, it } from 'vitest'

import { friends, strangers } from './fixtures'

/**
 * Which list the fake announces, and when.
 *
 * A conversation's place is decided by `lastActivity` and `priority`, so a row that moved has to
 * say so - a `conversation-updated` names the row and not its position. But a conversation is in
 * exactly one of the two lists, so only one of them can have changed, unless the row crossed
 * between them.
 */
describe('the fake announces the list a row moved in', () => {
  it('replaces the conversation list when a message arrives, and not the request list', async () => {
    const { world, clients } = friends(['Alice', 'Bob'])
    const alice = clients['Alice']
    const bob = clients['Bob']
    if (!alice || !bob) throw new Error('fixture did not produce both clients')

    const seen: string[] = []
    const stop = alice.onEvent((event) => seen.push(event.type))
    await bob.sendMessage(world.account('Alice').sessionId, { body: 'hello' })
    world.settle()
    stop()

    const saw = `saw: ${seen.join(', ')}`
    expect(seen, saw).toContain('conversation-updated')
    expect(seen, saw).toContain('conversation-list-replaced')
    // Alice and Bob are already friends, so nothing about the request list changed.
    expect(seen, saw).not.toContain('request-list-replaced')
  })

  it('replaces the request list when a message arrives for a request, and not the other', async () => {
    const { world, clients } = strangers(['Alice', 'Bob'])
    const alice = clients['Alice']
    const bob = clients['Bob']
    if (!alice || !bob) throw new Error('fixture did not produce both clients')

    const seen: string[] = []
    const stop = alice.onEvent((event) => seen.push(event.type))
    await bob.sendMessage(world.account('Alice').sessionId, { body: 'let me in again' })
    world.settle()
    stop()

    const saw = `saw: ${seen.join(', ')}`
    expect(seen, saw).toContain('request-list-replaced')
    expect(seen, saw).not.toContain('conversation-list-replaced')
  })

  it('replaces both when a row crosses between them', async () => {
    const { world, clients } = strangers(['Alice', 'Bob'])
    const alice = clients['Alice']
    if (!alice) throw new Error('fixture did not produce a client')

    const [request] = await alice.getMessageRequests()
    if (!request) throw new Error('expected a request to approve')

    const seen: string[] = []
    const stop = alice.onEvent((event) => seen.push(event.type))
    await alice.approveConversation(request.id)
    world.settle()
    stop()

    // The only case where both genuinely changed: one list lost the row, the other gained it.
    const saw = `saw: ${seen.join(', ')}`
    expect(seen, saw).toContain('conversation-list-replaced')
    expect(seen, saw).toContain('request-list-replaced')
  })

  it('says nothing about either list when the row did not move', async () => {
    const { world, clients } = friends(['Alice', 'Bob'])
    const alice = clients['Alice']
    const bob = clients['Bob']
    if (!alice || !bob) throw new Error('fixture did not produce both clients')

    await bob.sendMessage(world.account('Alice').sessionId, { body: 'hello' })
    world.settle()

    const seen: string[] = []
    const stop = alice.onEvent((event) => seen.push(event.type))
    const [conversation] = await alice.getConversations()
    if (!conversation) throw new Error('expected a conversation')
    await alice.markRead(conversation.id)
    world.settle()
    stop()

    // The row changed - it has no unread messages now - but it has not moved, and rebuilding a
    // list to say so is work for nothing.
    const saw = `saw: ${seen.join(', ')}`
    expect(seen, saw).toContain('conversation-updated')
    expect(seen, saw).not.toContain('conversation-list-replaced')
    expect(seen, saw).not.toContain('request-list-replaced')
  })
})
