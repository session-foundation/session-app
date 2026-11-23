import { Icon } from '../../Icon'
import { SettingsNote, SettingsRow, type SettingsRowProps } from '../../SettingsRow'
import { Switch } from '../../Switch'
import { Text } from '../../Text'
import { defineStory } from '../story'
import { LONG, noop } from './shared'

const ROW = { onPress: noop } as const

/**
 * The note that stands where a row has gone, among the rows so its height and inset are seen
 * against theirs.
 */
interface NoteVariant {
  note: string
  testID: string
}

export const settingsRow = defineStory<SettingsRowProps | NoteVariant>({
  component: 'settingsRow',
  story: 'variants',
  width: 390,
  forced: ['hover', 'press', 'focus'],
  sensitive: { rtl: true, responsive: true, accent: true },
  variants: {
    plain: {
      ...ROW,
      testID: 'catalog-settings-row-plain',
      label: 'Notifications',
      icon: 'bellOff',
    },
    subtitle: {
      ...ROW,
      testID: 'catalog-settings-row-subtitle',
      label: 'Privacy',
      subtitle: 'Read receipts, typing indicators',
      icon: 'lockKeyhole',
    },
    trailing: {
      ...ROW,
      testID: 'catalog-settings-row-trailing',
      label: 'Language',
      icon: 'clock',
      trailing: <Text tone="secondary">English</Text>,
    },
    switch: {
      testID: 'catalog-settings-row-switch',
      label: 'Read receipts',
      subtitle: 'Show that you have read a message',
      trailing: (
        <Switch
          value
          onValueChange={noop}
          accessibilityLabel="Read receipts"
          testID="catalog-settings-row-switch-control"
        />
      ),
    },
    // A developer setting: an explanation in paragraphs, then how it stands, a line under it.
    details: {
      testID: 'catalog-settings-row-details',
      label: 'Disable Animations',
      subtitle:
        'Turns off animations and transitions.\n\nApplies to screens drawn after the change.',
      details: [{ label: 'Current:', value: 'Enabled (set here)' }],
      trailing: (
        <Switch
          value
          onValueChange={noop}
          accessibilityLabel="Disable Animations"
          testID="catalog-settings-row-details-control"
        />
      ),
    },
    // The row that opens a screen of settings, summarising them: several lines, one not in
    // effect, and one too long for its line.
    detailsSummary: {
      ...ROW,
      testID: 'catalog-settings-row-detailsSummary',
      label: 'Network Configuration',
      subtitle: 'Configure settings related to how and where network requests are sent.',
      details: [
        { label: 'Service Network:', value: 'Mainnet' },
        { label: 'Router:', value: 'Onion Requests' },
        { label: 'Mock Status:', value: 'None', inactive: true },
        { label: 'Server:', value: 'a-rather-long-host-name.example.org/files/v2' },
      ],
      trailing: <Icon name="chevronRight" size="md" color="$textPrimary" />,
    },
    accentIcon: {
      ...ROW,
      testID: 'catalog-settings-row-accentIcon',
      label: 'Session Pro',
      icon: 'settings',
      accentIcon: true,
    },
    destructive: {
      ...ROW,
      testID: 'catalog-settings-row-destructive',
      label: 'Clear data',
      icon: 'trash',
      destructive: true,
    },
    disabled: {
      ...ROW,
      testID: 'catalog-settings-row-disabled',
      label: 'Notifications',
      icon: 'bellOff',
      disabled: true,
    },
    arabic: {
      ...ROW,
      testID: 'catalog-settings-row-arabic',
      label: 'الإشعارات',
      subtitle: 'إيصالات القراءة ومؤشرات الكتابة',
      icon: 'bellOff',
      trailing: <Text tone="secondary">مفعّل</Text>,
    },
    long: {
      ...ROW,
      testID: 'catalog-settings-row-long',
      label: LONG,
      subtitle: LONG,
      icon: 'clock',
    },
    note: { testID: 'catalog-settings-note', note: 'Recovery Password hidden on this device' },
    noteArabic: {
      testID: 'catalog-settings-note-arabic',
      note: 'تم إخفاء كلمة مرور الاسترداد على هذا الجهاز',
    },
    noteLong: { testID: 'catalog-settings-note-long', note: LONG },
  },
  render: (props) =>
    'note' in props ? (
      <SettingsNote text={props.note} testID={props.testID} />
    ) : (
      <SettingsRow {...props} />
    ),
})
