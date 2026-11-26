import type { DeliveryModeOffer, NotificationsPort } from '@session/app'
import { PENDING_COPY, tr } from '@session/localization'
import type { DeliveryMode } from '@session/state'
import { ELEMENT } from '@session/test-ids'
import {
  RadioIndicator,
  SettingsGroup,
  SettingsNote,
  SettingsRow,
  Switch,
  YStack,
} from '@session/ui'
import { deliveryModeDescription, deliveryModeTitle } from '../../deliveryModes'

import { needsBackgroundActivity } from './choices'

export interface MessageDeliveryContentProps {
  offers: readonly DeliveryModeOffer[]
  pushService: NotificationsPort['pushService']
  selected: DeliveryMode | null
  /** Android's battery exemption: null where the platform has none. */
  backgroundAllowed: boolean | null
  /** iOS's Background App Refresh: null where the platform has none or cannot say. */
  backgroundRefreshOn: boolean | null
  onSelect: (mode: DeliveryMode) => void
  onBackgroundActivity: () => void
  onOpenSettings: () => void
}

/** The Message delivery child screen, as drawn: one choice, each saying all it does. */
export function MessageDeliveryContent(props: MessageDeliveryContentProps) {
  const refreshWarning =
    props.backgroundRefreshOn === false &&
    (props.selected === 'instant' || props.selected === 'periodic')
      ? props.selected === 'instant'
        ? PENDING_COPY.backgroundRefreshOffInstant
        : PENDING_COPY.backgroundRefreshOffPeriodic
      : null
  return (
    <YStack padding="$md" gap="$lg" testID={ELEMENT.notificationSettings.deliveryScreen}>
      <SettingsGroup>
        {props.offers.map((offer) => {
          const usable = offer.unavailable === null
          const description = deliveryModeDescription(offer, props.pushService)
          return (
            <SettingsRow
              key={offer.mode}
              label={deliveryModeTitle(offer.mode, props.pushService)}
              subtitle={description}
              note={
                offer.mode === 'instant' && usable
                  ? PENDING_COPY.deliveryInstantCommunities
                  : undefined
              }
              trailing={
                <RadioIndicator selected={offer.mode === props.selected} disabled={!usable} />
              }
              disabled={!usable}
              onPress={() => props.onSelect(offer.mode)}
              testID={ELEMENT.notificationSettings.deliveryOption(offer.mode)}
            />
          )
        })}
      </SettingsGroup>
      {props.backgroundAllowed !== null && needsBackgroundActivity(props.selected) ? (
        <SettingsGroup>
          <SettingsRow
            label={tr('runAppBackground')}
            subtitle={PENDING_COPY.backgroundActivityDescription}
            trailing={
              <Switch
                value={props.backgroundAllowed}
                // Android decides, in its own dialog or its list; the switch follows when the app
                // comes back.
                onValueChange={props.onBackgroundActivity}
                accessibilityLabel={tr('runAppBackground')}
                testID={ELEMENT.notificationSettings.backgroundActivity}
              />
            }
            testID={ELEMENT.notificationSettings.backgroundActivity}
          />
        </SettingsGroup>
      ) : null}
      {refreshWarning === null ? null : (
        <SettingsGroup>
          <SettingsNote
            text={refreshWarning}
            testID={ELEMENT.notificationSettings.backgroundRefreshWarning}
          />
          {/* Background App Refresh is on the app's page in Settings, not under notifications. */}
          <SettingsRow
            label={tr('openSettings')}
            leadsTo="outside"
            onPress={props.onOpenSettings}
            testID={ELEMENT.notificationSettings.deviceSettings}
          />
        </SettingsGroup>
      )}
    </YStack>
  )
}
