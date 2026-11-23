import { friends } from '@session/client/fake'
import { createSessionStore } from '@session/state'
import { afterEach, describe, expect, it } from 'vitest'

import { memoryPorts, resetPorts, setPorts } from '#src/index'
import {
  FLAGS,
  changedSinceLaunch,
  flag,
  flagSnapshot,
  forgetLaunchedFlags,
  setFlagToggles,
} from '#src/flags'
import { followFlagToggles } from '#src/flagToggles'

afterEach(() => {
  resetPorts()
  setFlagToggles({})
  forgetLaunchedFlags()
})

describe('followFlagToggles', () => {
  it("has the account's switched flags in place by the update that marks it hydrated", async () => {
    setPorts(memoryPorts({ flags: { override: () => null } }))
    const { clients } = friends(['Alice', 'Bob'])
    const client = clients['Alice']
    if (!client) throw new Error('fixture did not produce a client')
    const first = createSessionStore(client)
    await first.actions.hydrate()
    await first.actions.setFlagToggle('disableAnimations', true)

    // A fresh start: what a screen drawn on `hydrated` would read.
    const store = createSessionStore(client)
    const stop = followFlagToggles(store)
    let atHydrated: boolean | null = null
    store.subscribe((state, previous) => {
      if (state.hydrated && !previous.hydrated) atHydrated = flag('disableAnimations')
    })
    await store.actions.hydrate()
    expect(atHydrated).toBe(true)

    await store.actions.setFlagToggle('disableAnimations', null)
    expect(flag('disableAnimations')).toBe(false)
    stop()
  })

  it('ignores a stored switch for a flag this build does not have', async () => {
    setPorts(memoryPorts({ flags: { override: () => null } }))
    const { clients } = friends(['Alice', 'Bob'])
    const client = clients['Alice']
    if (!client) throw new Error('fixture did not produce a client')
    const store = createSessionStore(client)
    const stop = followFlagToggles(store)
    await store.actions.hydrate()
    await store.actions.setFlagToggle('noLongerAFlag', true)
    // Kept as stored, so a later build that has it again finds it, and harmless meanwhile.
    expect(store.getState().flagToggles).toEqual({ noLongerAFlag: true })
    expect(flagSnapshot()).toEqual(Object.fromEntries(Object.entries(FLAGS)))
    stop()
  })

  /**
   * What the restart banner goes by: the values as the account opened, with its switches in
   * place, so a switch stored before this launch is not a change and one made since is, until it
   * is put back.
   */
  it('records the values the account opened with, and says which a switch has changed since', async () => {
    setPorts(memoryPorts({ flags: { override: () => null } }))
    const { clients } = friends(['Alice', 'Bob'])
    const client = clients['Alice']
    if (!client) throw new Error('fixture did not produce a client')
    const first = createSessionStore(client)
    await first.actions.hydrate()
    await first.actions.setFlagToggle('disableAnimations', true)

    const store = createSessionStore(client)
    const stop = followFlagToggles(store)
    expect(changedSinceLaunch('disableAnimations')).toBe(false)
    await store.actions.hydrate()
    expect(changedSinceLaunch('disableAnimations')).toBe(false)

    await store.actions.setFlagToggle('disableAnimations', false)
    expect(changedSinceLaunch('disableAnimations')).toBe(true)
    await store.actions.setFlagToggle('disableAnimations', true)
    expect(changedSinceLaunch('disableAnimations')).toBe(false)
    stop()
  })
})
