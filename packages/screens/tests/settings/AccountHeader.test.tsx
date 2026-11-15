import { memoryPorts, resetPorts, setPorts } from '@session/app'
import { tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'
import { byId, declared, nodeOf } from '@session/render-tier'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AccountHeader } from '#src/settings/AccountHeader'

import { renderScreen } from '../support/render'

const SESSION_ID = '05b2c7e1d4a8f3906e5c1b7d2a4f8e3c9b6d1a5e7f2c4b8d3a9e6f1c5b7d2a4e8f'

/** The drawn disc's width: the press area carries the id, and the disc is inside its frame. */
function avatarWidth(): string | undefined {
  const disc = byId(ELEMENT.settings.avatar).firstElementChild?.firstElementChild
  if (disc === null || disc === undefined) throw new Error('no disc inside the avatar')
  return declared(disc)['width']
}

beforeEach(() => {
  setPorts(memoryPorts())
})

afterEach(() => {
  resetPorts()
})

describe('the account header', () => {
  it('swaps the display picture for the QR code and back, hiding the name meanwhile', async () => {
    renderScreen(<AccountHeader sessionId={SESSION_ID} name="Alice" />)
    expect(nodeOf(ELEMENT.settings.qrToggle)?.name).toBe(tr('qrView'))

    await userEvent.click(byId(ELEMENT.settings.qrToggle))
    expect(nodeOf(ELEMENT.settings.accountQr)?.name).toBe(tr('qrCode'))
    expect(nodeOf(ELEMENT.settings.avatar)).toBeNull()
    expect(nodeOf(ELEMENT.settings.displayName)).toBeNull()
    // The ID stays: the code stands for it.
    expect(nodeOf(ELEMENT.settings.copyAccountId)).not.toBeNull()

    expect(nodeOf(ELEMENT.settings.qrBack)?.name).toBe(tr('profileDisplayPicture'))
    await userEvent.click(byId(ELEMENT.settings.qrBack))
    expect(nodeOf(ELEMENT.settings.accountQr)).toBeNull()
    expect(nodeOf(ELEMENT.settings.avatar)).not.toBeNull()
    expect(nodeOf(ELEMENT.settings.displayName)).not.toBeNull()
  })

  it('enlarges the display picture when pressed, and shrinks it on the next press', async () => {
    renderScreen(<AccountHeader sessionId={SESSION_ID} name="Alice" />)
    const resting = avatarWidth()

    await userEvent.click(byId(ELEMENT.settings.avatar))
    const enlarged = avatarWidth()
    expect(enlarged).not.toBe(resting)
    expect(enlarged).toBe('190px')

    await userEvent.click(byId(ELEMENT.settings.avatar))
    expect(avatarWidth()).toBe(resting)
  })

  it('keeps the enlarged picture across a trip to the QR code and back', async () => {
    renderScreen(<AccountHeader sessionId={SESSION_ID} name="Alice" />)
    await userEvent.click(byId(ELEMENT.settings.avatar))
    await userEvent.click(byId(ELEMENT.settings.qrToggle))
    await userEvent.click(byId(ELEMENT.settings.qrBack))
    expect(avatarWidth()).toBe('190px')
  })
})
