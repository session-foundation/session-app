import { DEVELOPER_COPY, DEVELOPER_FLAGS, type DeveloperFlag } from '@session/app'
import { tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  DeveloperRestartBanner,
  DeveloperSettingsContent,
  type DeveloperSettingsContentProps,
} from '#src/settings/DeveloperSettingsPage'

import { renderScreen } from '../support/render'

function firstFlag(): DeveloperFlag {
  const first = DEVELOPER_FLAGS[0]
  if (first === undefined) throw new Error('Developer Settings lists no flag')
  return first
}

const FIRST = firstFlag()

function draw(
  overrides: Partial<DeveloperSettingsContentProps> = {},
): DeveloperSettingsContentProps {
  const props: DeveloperSettingsContentProps = {
    flags: [{ flag: FIRST, value: false, source: 'default' }],
    canReset: true,
    onDebugModeOff: vi.fn(),
    onFlagChange: vi.fn(),
    onReset: vi.fn(),
    ...overrides,
  }
  renderScreen(<DeveloperSettingsContent {...props} />)
  return props
}

describe('Developer Settings', () => {
  it("turns debug mode off from its switch, and a flag's switch asks for the other value", () => {
    const props = draw()
    fireEvent.click(screen.getByRole('switch', { name: DEVELOPER_COPY.debugModeTitle }))
    expect(props.onDebugModeOff).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('switch', { name: FIRST.title }))
    expect(props.onFlagChange).toHaveBeenCalledWith(FIRST.name, true)
  })

  it('puts the flags back from Reset', () => {
    const props = draw()
    fireEvent.click(screen.getByRole('button', { name: DEVELOPER_COPY.resetFlags }))
    expect(props.onReset).toHaveBeenCalledOnce()
  })

  it('does nothing from Reset with nothing to put back', () => {
    const props = draw({ canReset: false })
    fireEvent.click(screen.getByTestId(ELEMENT.developerSettings.resetFlags))
    expect(props.onReset).not.toHaveBeenCalled()
  })
})

describe('the restart banner', () => {
  it('relaunches where the platform can', () => {
    const onRestart = vi.fn()
    renderScreen(<DeveloperRestartBanner onRestart={onRestart} />)
    fireEvent.click(screen.getByRole('button', { name: tr('restart') }))
    expect(onRestart).toHaveBeenCalledOnce()
  })

  it('offers no Restart where the platform cannot relaunch', () => {
    renderScreen(<DeveloperRestartBanner onRestart={null} />)
    expect(screen.getByTestId(ELEMENT.developerSettings.restartBanner)).toBeTruthy()
    expect(screen.queryByRole('button', { name: tr('restart') })).toBeNull()
  })
})
