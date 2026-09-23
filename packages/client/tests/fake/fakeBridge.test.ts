import type { Frame, SessionEvent } from '@session/bridge-types'
import { describe, expect, it } from 'vitest'

import { createSessionClient } from '#src/createSessionClient'
import { createFakeTransport } from '#src/fake/fakeBridge'
import { friends } from '#src/fake/fixtures'

/**
 * The fake, driven through the real facade over the transport interface.
 *
 * This is the whole pipeline the apps use - request, transport, correlate, event - with only the
 * C++ missing. A break in any of those layers fails here rather than in an app.
 */
function connect() {
  const { world, clients } = friends(['Alice', 'Bob'])
  const alice = clients['Alice']
  if (!alice) throw new Error('fixture did not produce Alice')

  const transport = createFakeTransport(alice)
  const client = createSessionClient(transport)
  const events: SessionEvent[] = []
  client.onEvent((event) => events.push(event))

  return { client, events, world, bobId: world.account('Bob').sessionId }
}

describe('the bridge protocol, end to end', () => {
  it('answers a request on the stream', async () => {
    const { client } = connect()
    const info = await client.getAccountInfo()
    expect(info.haveAccount).toBe(true)
    expect(info.displayName).toBe('Alice')
  })

  it('carries a conversation list across', async () => {
    const { client, bobId } = connect()
    const conversations = await client.getConversations()
    expect(conversations.map((c) => c.id)).toContain(bobId)
    expect(conversations[0]?.displayName).toBe('Bob')
  })

  it('sends, and reports the states that follow as events', async () => {
    const { client, events, world, bobId } = connect()

    const messageId = await client.sendMessage(bobId, { body: 'hello' })
    expect(messageId).toBeGreaterThan(0)

    const added = events.find((e) => e.type === 'messages-added')
    if (added?.type !== 'messages-added') throw new Error('unreachable')
    expect(added.messages.map((m) => m.body)).toEqual(['hello'])

    world.settle()

    // Flattened rather than read off the last batch: a batch may carry several, and which batch
    // the final state lands in is the bridge's business rather than this test's.
    const updated = events
      .filter((e) => e.type === 'messages-updated')
      .flatMap((e) => (e.type === 'messages-updated' ? e.messages : []))
    expect(updated[updated.length - 1]?.sendState).toBe('sent')
  })

  it('turns a failure into a rejected promise with the message intact', async () => {
    const { client } = connect()
    await expect(client.getConversation('05nope')).rejects.toThrow(/No such conversation/)
  })

  it('answers a command it does not serve with an error on the stream, like the shim', async () => {
    const { clients } = friends(['Alice', 'Bob'])
    const alice = clients['Alice']
    if (!alice) throw new Error('fixture did not produce Alice')
    const transport = createFakeTransport(alice)

    const answered = new Promise<Frame>((resolve) => {
      transport.setSink((frame) => {
        if (frame.type === 'response' && frame.response.id === 7) resolve(frame)
      })
    })
    transport.send({ id: 7, command: { type: 'getTestAccountSeed' } })

    const frame = await answered
    if (frame.type !== 'response') throw new Error('unreachable')
    expect(frame.response.error).toContain('getTestAccountSeed')
    expect(frame.response.result).toBeUndefined()
  })
})
