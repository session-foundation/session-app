import { PENDING_COPY, singular, tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  MessageDeliveryContent,
  NotificationSoundChoice,
  previewSample,
  type MessageDeliveryContentProps,
} from '#src/settings/NotificationsPage'

import { renderScreen } from '../support/render'

function draw(overrides: Partial<MessageDeliveryContentProps> = {}): MessageDeliveryContentProps {
  const props: MessageDeliveryContentProps = {
    offers: [
      { mode: 'instant', unavailable: 'build' },
      { mode: 'always-connected', unavailable: null },
      { mode: 'periodic', unavailable: null },
    ],
    pushService: null,
    selected: 'always-connected',
    backgroundAllowed: false,
    backgroundRefreshOn: null,
    onSelect: vi.fn(),
    onBackgroundActivity: vi.fn(),
    onOpenSettings: vi.fn(),
    ...overrides,
  }
  renderScreen(<MessageDeliveryContent {...props} />)
  return props
}

describe('the Message delivery screen', () => {
  it('chooses a mode that can be used, and not one that cannot', () => {
    const props = draw()
    fireEvent.click(screen.getByTestId(ELEMENT.notificationSettings.deliveryOption('periodic')))
    expect(props.onSelect).toHaveBeenCalledWith('periodic')

    fireEvent.click(screen.getByTestId(ELEMENT.notificationSettings.deliveryOption('instant')))
    expect(props.onSelect).toHaveBeenCalledTimes(1)
  })

  it("offers Android's battery exemption only for the modes that run in the background", () => {
    const props = draw()
    fireEvent.click(screen.getByRole('switch', { name: tr('runAppBackground') }))
    expect(props.onBackgroundActivity).toHaveBeenCalledOnce()
  })

  it('leaves the battery exemption out for Instant and Only while open', () => {
    for (const selected of ['instant', 'while-open'] as const) {
      const { unmount } = renderScreen(
        <MessageDeliveryContent
          offers={[{ mode: selected, unavailable: null }]}
          pushService="google"
          selected={selected}
          backgroundAllowed={false}
          backgroundRefreshOn={null}
          onSelect={vi.fn()}
          onBackgroundActivity={vi.fn()}
          onOpenSettings={vi.fn()}
        />,
      )
      expect(
        screen.queryByTestId(ELEMENT.notificationSettings.backgroundActivity),
        selected,
      ).toBeNull()
      unmount()
    }
  })

  it('says what Background App Refresh being off costs the mode chosen', () => {
    draw({
      offers: [{ mode: 'periodic', unavailable: null }],
      selected: 'periodic',
      backgroundAllowed: null,
      backgroundRefreshOn: false,
    })
    expect(screen.getByText(PENDING_COPY.backgroundRefreshOffPeriodic)).toBeTruthy()
  })
})

describe('Preview Notification', () => {
  it('shows what a message notification shows with each content setting', () => {
    expect(previewSample('nameAndContent')).toEqual({
      title: tr('preview'),
      body: PENDING_COPY.previewNotificationBody,
    })
    expect(previewSample('nameOnly').title).toBe(tr('preview'))
    expect(previewSample('nameOnly').body).toBe(singular('messageNewYouveGot'))
    expect(previewSample('none').title).toBe(tr('appName'))
  })
})

describe('the Sound screen', () => {
  it('offers no sound as a choice of its own, and picks the sound pressed', () => {
    const onSelect = vi.fn()
    renderScreen(<NotificationSoundChoice selected="note" onSelect={onSelect} />)
    fireEvent.click(screen.getByTestId(ELEMENT.notificationSettings.soundOption('none')))
    expect(onSelect).toHaveBeenLastCalledWith('none')
    fireEvent.click(screen.getByTestId(ELEMENT.notificationSettings.soundOption('synth')))
    expect(onSelect).toHaveBeenLastCalledWith('synth')
  })
})
