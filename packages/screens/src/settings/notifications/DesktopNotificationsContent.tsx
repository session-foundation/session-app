import { tr } from '@session/localization'
import type { NotificationContent } from '@session/client'
import { ELEMENT } from '@session/test-ids'
import { SettingsGroup, SettingsRow, SettingsSection, Switch, YStack } from '@session/ui'

import { ContentChoices, PreviewGroup } from './ContentChoice'

export interface DesktopNotificationsContentProps {
  shown: boolean
  content: NotificationContent
  audio: boolean
  canPreview: boolean
  onShown: (on: boolean) => void
  onContent: (content: NotificationContent) => void
  onAudio: (on: boolean) => void
  onPreview: () => void
}

/**
 * Desktop's Notifications page, as legacy desktop has it: whether to show notifications at all,
 * their sound, then what they show, each group under its label. It keeps running, so there is no
 * delivery to choose.
 */
export function DesktopNotificationsContent(props: DesktopNotificationsContentProps) {
  return (
    <YStack padding="$md" gap="$lg" testID={ELEMENT.notificationSettings.screen}>
      <YStack>
        <SettingsSection label={tr('sessionNotifications')} />
        <SettingsGroup>
          <SettingsRow
            label={tr('sessionNotifications')}
            subtitle={tr('enableNotifications')}
            trailing={
              <Switch
                value={props.shown}
                onValueChange={props.onShown}
                accessibilityLabel={tr('sessionNotifications')}
                testID={ELEMENT.notificationSettings.shown}
              />
            }
            testID={ELEMENT.notificationSettings.shown}
          />
        </SettingsGroup>
      </YStack>
      {/* Everything else is about notifications that are shown, so goes with them. */}
      {props.shown ? (
        <>
          <YStack>
            <SettingsSection label={tr('notificationsSoundDesktop')} />
            <SettingsGroup>
              <SettingsRow
                label={tr('notificationsSoundDesktop')}
                subtitle={tr('notificationsMakeSound')}
                trailing={
                  <Switch
                    value={props.audio}
                    onValueChange={props.onAudio}
                    accessibilityLabel={tr('notificationsSoundDesktop')}
                    testID={ELEMENT.notificationSettings.audio}
                  />
                }
                testID={ELEMENT.notificationSettings.audio}
              />
            </SettingsGroup>
          </YStack>
          <YStack>
            <SettingsSection
              label={tr('notificationDisplay')}
              description={tr('contentNotificationDescription')}
            />
            <YStack gap="$lg">
              <ContentChoices selected={props.content} describe onSelect={props.onContent} />
              {props.canPreview ? <PreviewGroup onPreview={props.onPreview} /> : null}
            </YStack>
          </YStack>
        </>
      ) : null}
    </YStack>
  )
}
