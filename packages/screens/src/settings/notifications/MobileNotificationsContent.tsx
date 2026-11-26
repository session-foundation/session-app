import type { NotificationChannel } from '@session/app'
import { PENDING_COPY, tr } from '@session/localization'
import type { NotificationContent, NotificationSound } from '@session/client'
import { ELEMENT } from '@session/test-ids'
import { SettingsGroup, SettingsNote, SettingsRow, Switch, YStack } from '@session/ui'

import { contentLabel, soundName } from './choices'

export interface MobileNotificationsContentProps {
  /** The mode in effect, named: Only while open until one is chosen, since nothing else runs. */
  deliveryTitle: string
  content: NotificationContent
  /** The sound notifications play; null where it is not chosen in the app, which hides the row. */
  sound: NotificationSound | null
  soundWhenOpen: boolean
  /** False shows the warning; null when the OS cannot be asked. */
  notificationsAllowed: boolean | null
  channels: boolean
  canOpenSettings: boolean
  onDelivery: () => void
  onContent: () => void
  onSound: () => void
  onSoundWhenOpen: (on: boolean) => void
  onChannel: (channel: NotificationChannel) => void
  onOpenSettings: () => void
}

/** The phones' and tablets' Notifications page, as drawn. */
export function MobileNotificationsContent(props: MobileNotificationsContentProps) {
  return (
    <YStack padding="$md" gap="$lg" testID={ELEMENT.notificationSettings.screen}>
      {props.notificationsAllowed === false ? (
        <SettingsGroup>
          <SettingsNote
            text={PENDING_COPY.notificationsOffForSession}
            testID={ELEMENT.notificationSettings.permissionWarning}
          />
          {props.canOpenSettings ? (
            <SettingsRow
              label={tr('notificationsGoToDevice')}
              leadsTo="outside"
              onPress={props.onOpenSettings}
              testID={ELEMENT.notificationSettings.deviceSettings}
            />
          ) : null}
        </SettingsGroup>
      ) : null}
      <SettingsGroup>
        <SettingsRow
          label={PENDING_COPY.messageDelivery}
          subtitle={props.deliveryTitle}
          leadsTo="screen"
          onPress={props.onDelivery}
          testID={ELEMENT.notificationSettings.deliveryRow}
        />
      </SettingsGroup>
      <SettingsGroup>
        <SettingsRow
          label={tr('notificationsContent')}
          subtitle={contentLabel(props.content)}
          leadsTo="screen"
          onPress={props.onContent}
          testID={ELEMENT.notificationSettings.contentRow}
        />
        {props.sound === null ? null : (
          <SettingsRow
            label={tr('notificationsSound')}
            subtitle={soundName(props.sound)}
            leadsTo="screen"
            onPress={props.onSound}
            testID={ELEMENT.notificationSettings.soundRow}
          />
        )}
        <SettingsRow
          label={tr('notificationsSoundDescription')}
          trailing={
            <Switch
              value={props.soundWhenOpen}
              onValueChange={props.onSoundWhenOpen}
              accessibilityLabel={tr('notificationsSoundDescription')}
              testID={ELEMENT.notificationSettings.soundWhenOpen}
            />
          }
          testID={ELEMENT.notificationSettings.soundWhenOpen}
        />
      </SettingsGroup>
      {props.channels ? (
        <SettingsGroup>
          <SettingsRow
            label={tr('messages')}
            subtitle={tr('deviceSettingsConversationNotifications')}
            leadsTo="outside"
            onPress={() => props.onChannel('messages')}
            testID={ELEMENT.notificationSettings.channel('messages')}
          />
          <SettingsRow
            label={tr('sessionMessageRequests')}
            subtitle={PENDING_COPY.deviceSettingsMessageRequestNotifications}
            leadsTo="outside"
            onPress={() => props.onChannel('requests')}
            testID={ELEMENT.notificationSettings.channel('requests')}
          />
          {/* Shown disabled until calls exist, so the list keeps its order. */}
          <SettingsRow
            label={tr('callsSettings')}
            subtitle={tr('deviceSettingsCallNotifications')}
            leadsTo="outside"
            disabled
            testID={ELEMENT.notificationSettings.channel('calls')}
          />
        </SettingsGroup>
      ) : null}
      {props.canOpenSettings && props.notificationsAllowed !== false ? (
        <SettingsGroup>
          <SettingsRow
            label={tr('notificationsGoToDevice')}
            leadsTo="outside"
            onPress={props.onOpenSettings}
            testID={ELEMENT.notificationSettings.deviceSettings}
          />
        </SettingsGroup>
      ) : null}
    </YStack>
  )
}
