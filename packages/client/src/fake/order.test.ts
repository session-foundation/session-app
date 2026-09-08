import { describe, expect, it } from 'vitest'

import { friends } from './fixtures'

describe('the fake announces list order the way libsession does', () => {
  it('sends the lists when a message changes where a conversation belongs', async () => {
    const { world, clients } = friends(['Alice', 'Bob'])
    const alice = clients['Alice']
    const bob = clients['Bob']
    if (!alice || !bob) throw new Error('fixture did not produce both clients')

    const seen: string[] = []
    const stop = alice.onEvent((event) => seen.push(event.type))
    await bob.sendMessage(world.account('Alice').sessionId, { body: 'hello' })
    world.settle()
    stop()

    // The row, and then where it now sits: last_activity decides the order, so an update alone
    // would leave a display to sort for itself.
    expect(seen, `saw: ${seen.join(', ')}`).toContain('conversation-updated')
    expect(seen, `saw: ${seen.join(', ')}`).toContain('conversation-list-replaced')
    expect(seen, `saw: ${seen.join(', ')}`).toContain('request-list-replaced')
  })
})

describe('but not when the row stayed where it was', () => {
  it('says nothing about the lists when only the unread count changed', async () => {
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

    // The row changed - it has no unread messages now - but it has not moved, and replacing both
    // lists to say so is two rebuilds for nothing.
    expect(seen, `saw: ${seen.join(', ')}`).toContain('conversation-updated')
    expect(seen, `saw: ${seen.join(', ')}`).not.toContain('conversation-list-replaced')
  })
})
