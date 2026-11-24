import { flag, type DeliveryModeOffer, type NotificationsPort } from '@session/app'
import { PENDING_COPY } from '@session/localization'
import type { DeliveryMode } from '@session/state'

/** The modes as this device offers them, with the developer flag that makes Instant usable. */
export function deliveryOffers(notifications: NotificationsPort): readonly DeliveryModeOffer[] {
  // The flag is a way to look at the screens, not a second source of truth: see its entry in the
  // flag table for why Instant is otherwise unreachable on a development machine.
  if (!flag('forceFastModeAvailable')) return notifications.deliveryModes
  return notifications.deliveryModes.map((offer) =>
    offer.mode === 'instant' ? { ...offer, unavailable: null } : offer,
  )
}

/** The first mode that can be used, which is the recommended one; null when none can. */
export function recommendedMode(offers: readonly DeliveryModeOffer[]): DeliveryMode | null {
  return offers.find((offer) => offer.unavailable === null)?.mode ?? null
}

function pushTitle(service: NotificationsPort['pushService']): string {
  if (service === 'google') return PENDING_COPY.deliveryPushGoogle
  if (service === 'apple') return PENDING_COPY.deliveryPushApple
  if (service === 'huawei') return PENDING_COPY.deliveryPushHuawei
  return PENDING_COPY.deliveryPush
}

/** A mode's name. The push mode is named by the service the build would use. */
export function deliveryModeTitle(
  mode: DeliveryMode,
  service: NotificationsPort['pushService'],
): string {
  switch (mode) {
    case 'instant':
      return pushTitle(service)
    case 'always-connected':
      return PENDING_COPY.deliveryAlwaysConnected
    case 'periodic':
      return PENDING_COPY.deliveryPeriodic
    case 'while-open':
      return PENDING_COPY.deliveryWhileOpen
  }
}

function instantDescription(service: NotificationsPort['pushService']): string {
  if (service === 'google') return PENDING_COPY.deliveryInstantDescriptionGoogle
  if (service === 'apple') return PENDING_COPY.deliveryInstantDescriptionApple
  if (service === 'huawei') return PENDING_COPY.deliveryInstantDescriptionHuawei
  return PENDING_COPY.deliveryInstantDescription
}

function unavailableReason(
  why: 'build' | 'device',
  service: NotificationsPort['pushService'],
): string {
  if (why === 'build') return PENDING_COPY.deliveryUnavailableBuild
  if (service === 'google') return PENDING_COPY.deliveryUnavailableDeviceGoogle
  if (service === 'huawei') return PENDING_COPY.deliveryUnavailableDeviceHuawei
  return PENDING_COPY.deliveryUnavailableDevice
}

/**
 * What a mode does, or why it cannot be used here. Instant names the push service the build would
 * use, since each one learns something different about who gets messages.
 */
export function deliveryModeDescription(
  offer: DeliveryModeOffer,
  service: NotificationsPort['pushService'],
): string {
  if (offer.unavailable !== null) return unavailableReason(offer.unavailable, service)
  switch (offer.mode) {
    case 'instant':
      return instantDescription(service)
    case 'always-connected':
      return PENDING_COPY.deliveryAlwaysConnectedDescription
    case 'periodic':
      return PENDING_COPY.deliveryPeriodicDescription
    case 'while-open':
      return PENDING_COPY.deliveryWhileOpenDescription
  }
}
