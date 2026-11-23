import { userEvent } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { pressArea } from '@session/expectations'
import { ELEMENT } from '@session/test-ids'

import { TopTabs } from '#src/TopTabs'

import { byId, nodeOf } from '@session/render-tier'
import { renderInUI } from './support/render'

const PHRASE = ELEMENT.onboarding.recoveryPhraseTab
const QR = ELEMENT.onboarding.scanQrTab

function tabs(onChange: (key: string) => void, disabled: boolean) {
  return (
    <TopTabs
      active="phrase"
      instant
      onChange={onChange}
      tabs={[
        { key: 'phrase', label: 'Recovery Password', testID: PHRASE },
        { key: 'qr', label: 'Scan QR Code', testID: QR, disabled },
      ]}
    />
  )
}

describe('the web TopTabs', () => {
  it('selects a tab that is pressed', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderInUI(tabs(onChange, false))
    await user.click(byId(QR))
    expect(onChange).toHaveBeenCalledWith('qr')
  })

  it('announces a disabled tab as disabled and never selects it', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderInUI(tabs(onChange, true))
    expect(nodeOf(QR)).toMatchObject(pressArea({ name: 'Scan QR Code', disabled: true }).desktop!)
    await user.click(byId(QR))
    byId(QR).focus()
    await user.keyboard('{Enter}')
    expect(onChange).not.toHaveBeenCalled()
    await user.click(byId(PHRASE))
    expect(onChange).toHaveBeenCalledWith('phrase')
  })
})
