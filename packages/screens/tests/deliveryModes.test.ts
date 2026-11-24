import { PENDING_COPY } from '@session/localization'
import { describe, expect, it } from 'vitest'

import { deliveryModeDescription, deliveryModeTitle, recommendedMode } from '#src/deliveryModes'

describe('the delivery modes as offered', () => {
  it('recommends the first that can be used', () => {
    expect(
      recommendedMode([
        { mode: 'instant', unavailable: 'build' },
        { mode: 'always-connected', unavailable: null },
        { mode: 'periodic', unavailable: null },
      ]),
    ).toBe('always-connected')
    expect(recommendedMode([{ mode: 'instant', unavailable: 'device' }])).toBeNull()
  })

  it('names the push mode after the service the build would use', () => {
    expect(deliveryModeTitle('instant', 'apple')).toBe(PENDING_COPY.deliveryPushApple)
    expect(deliveryModeTitle('instant', null)).toBe(PENDING_COPY.deliveryPush)
    expect(deliveryModeTitle('periodic', 'google')).toBe(PENDING_COPY.deliveryPeriodic)
  })

  it('names the push service Instant would use, and why it cannot be used here', () => {
    const instant = { mode: 'instant', unavailable: null } as const
    expect(deliveryModeDescription(instant, 'huawei')).toBe(
      PENDING_COPY.deliveryInstantDescriptionHuawei,
    )
    expect(deliveryModeDescription(instant, null)).toBe(PENDING_COPY.deliveryInstantDescription)
    expect(deliveryModeDescription({ ...instant, unavailable: 'build' }, 'google')).toBe(
      PENDING_COPY.deliveryUnavailableBuild,
    )
    expect(deliveryModeDescription({ ...instant, unavailable: 'device' }, 'google')).toBe(
      PENDING_COPY.deliveryUnavailableDeviceGoogle,
    )
  })
})
