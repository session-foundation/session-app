import type { Deletion } from '@session/bridge-types'
import { describe, expect, it } from 'vitest'

import { friends } from '#src/fake/index'

/** What a message reads as deleted after these deletes, in order. */
function deletedAfter(...scopes: Deletion[]): Deletion | undefined {
  const { world } = friends(['Alice', 'Bob'], { history: 0 })
  const [alice, bob] = [world.account('Alice'), world.account('Bob')]
  const message = alice.deliverFrom(bob, 'hello', world.now(), [])
  for (const scope of scopes) alice.deleteMessage(message.id, scope)
  return alice.messages(bob.sessionId).find((m) => m.id === message.id)?.deleted
}

describe("the fake's message delete", () => {
  it('records the scope it was asked for', () => {
    expect(deletedAfter('here')).toBe('here')
    expect(deletedAfter('everywhere')).toBe('everywhere')
    expect(deletedAfter('here', 'everywhere')).toBe('everywhere')
  })

  it('keeps a delete everywhere once made, as libsession keeps the widest scope', () => {
    expect(deletedAfter('everywhere', 'here')).toBe('everywhere')
  })
})
