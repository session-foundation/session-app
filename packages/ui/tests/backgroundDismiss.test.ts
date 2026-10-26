import { describe, expect, it, vi } from 'vitest'

import { backgroundDismissResponder } from '#src/backgroundDismiss'

describe('the background of a screen', () => {
  it('claims no touch while the keyboard is down, so a list under it can scroll', () => {
    const responder = backgroundDismissResponder(() => false, vi.fn())
    expect(responder.onStartShouldSetResponder()).toBe(false)
  })

  it('claims a touch while the keyboard is up, and puts the keyboard away on release', () => {
    const dismiss = vi.fn()
    const responder = backgroundDismissResponder(() => true, dismiss)
    expect(responder.onStartShouldSetResponder()).toBe(true)
    responder.onResponderRelease()
    expect(dismiss).toHaveBeenCalledOnce()
  })
})
