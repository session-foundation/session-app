import { tr } from '@session/localization'
import type { NotificationSound } from '@session/client'
import { ELEMENT } from '@session/test-ids'
import { RadioIndicator, SettingsGroup, SettingsRow, YStack } from '@session/ui'

import { NOTIFICATION_SOUNDS, DEFAULT_SOUND, soundName } from './choices'

export interface NotificationSoundChoiceProps {
  selected: NotificationSound
  onSelect: (sound: NotificationSound) => void
}

/** iOS's Sound child screen, as drawn: the sounds as radio rows, the default marked. */
export function NotificationSoundChoice(props: NotificationSoundChoiceProps) {
  return (
    <YStack padding="$md" gap="$lg" testID={ELEMENT.notificationSettings.soundScreen}>
      <SettingsGroup>
        {NOTIFICATION_SOUNDS.map((sound) => (
          <SettingsRow
            key={sound}
            label={soundName(sound)}
            {...(sound === DEFAULT_SOUND ? { subtitle: tr('theDefault') } : {})}
            trailing={<RadioIndicator selected={sound === props.selected} />}
            onPress={() => props.onSelect(sound)}
            testID={ELEMENT.notificationSettings.soundOption(sound)}
          />
        ))}
      </SettingsGroup>
    </YStack>
  )
}
