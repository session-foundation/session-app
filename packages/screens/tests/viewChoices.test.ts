import { describe, expect, it, vi } from 'vitest'

import { createViewChoices } from '#src/viewChoices'

describe('the attachment views chosen in a conversation', () => {
  it('remembers a choice per message', () => {
    const choices = createViewChoices()
    choices.choose(1, 'list')
    expect(choices.get(1)).toBe('list')
    expect(choices.get(2)).toBeUndefined()
  })

  it('tells its subscribers when a choice changes, and only then', () => {
    const choices = createViewChoices()
    const listener = vi.fn()
    const unsubscribe = choices.subscribe(listener)
    choices.choose(1, 'list')
    choices.choose(1, 'list')
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    choices.choose(1, 'gallery')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('keeps one message’s choice from changing what another reads', () => {
    const choices = createViewChoices()
    const before = choices.get(2)
    choices.choose(1, 'list')
    // A subscriber reading message 2 sees the same value, so React skips its re-render.
    expect(choices.get(2)).toBe(before)
  })
})
