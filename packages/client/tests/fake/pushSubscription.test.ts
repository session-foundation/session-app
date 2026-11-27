import { describe, expect, it } from 'vitest'

import { friends } from '#src/fake/index'

describe("the fake's push subscription", () => {
  it('sends only what changed, unless forced', async () => {
    const { world, clients } = friends(['Alice', 'Bob'], { history: 0 })
    const alice = clients['Alice']
    if (!alice) throw new Error('no Alice')
    await alice.attachNetwork({ netid: 'mainnet' })
    world.settle()

    expect(await alice.setPushToken('apns', 'aa'.repeat(32))).toBe(true)
    expect(await alice.setPushToken('apns', 'aa'.repeat(32))).toBe(false)
    // A reinstall that kept the database: the stored subscription matches, and is sent anyway.
    expect(await alice.setPushToken('apns', 'aa'.repeat(32), true)).toBe(true)
    expect(await alice.setPushToken('apns', 'aa'.repeat(32))).toBe(false)
  })
})
