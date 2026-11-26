import { tr } from '@session/localization'
import type { NotificationContent } from '@session/client'
import { ELEMENT } from '@session/test-ids'
import { RadioIndicator, SettingsGroup, SettingsRow, YStack } from '@session/ui'

import { CONTENT_CHOICES, contentLabel, contentDescription } from './choices'

/** The three content choices as radio rows; with `describe`, each with desktop's longer line. */
export function ContentChoices({
  selected,
  describe = false,
  onSelect,
}: {
  selected: NotificationContent
  describe?: boolean
  onSelect: (content: NotificationContent) => void
}) {
  return (
    <SettingsGroup>
      {CONTENT_CHOICES.map((choice) => (
        <SettingsRow
          key={choice}
          label={contentLabel(choice)}
          {...(describe ? { subtitle: contentDescription(choice) } : {})}
          trailing={<RadioIndicator selected={choice === selected} />}
          onPress={() => onSelect(choice)}
          testID={ELEMENT.notificationSettings.contentOption(choice)}
        />
      ))}
    </SettingsGroup>
  )
}

/** Preview Notification, beside the content choices: what it shows is what they choose. */
export function PreviewGroup({ onPreview }: { onPreview: () => void }) {
  return (
    <SettingsGroup>
      <SettingsRow
        label={tr('previewNotification')}
        onPress={onPreview}
        testID={ELEMENT.notificationSettings.preview}
      />
    </SettingsGroup>
  )
}

export interface NotificationContentChoiceProps {
  selected: NotificationContent
  canPreview: boolean
  onSelect: (content: NotificationContent) => void
  onPreview: () => void
}

/** The phones' Notification Content child screen, as drawn. */
export function NotificationContentChoice(props: NotificationContentChoiceProps) {
  return (
    <YStack padding="$md" gap="$lg">
      <ContentChoices selected={props.selected} onSelect={props.onSelect} />
      {props.canPreview ? <PreviewGroup onPreview={props.onPreview} /> : null}
    </YStack>
  )
}
