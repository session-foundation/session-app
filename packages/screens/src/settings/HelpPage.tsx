import { requirePorts, URLS } from '@session/app'
import { tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'
import {
  Button,
  KeyCombo,
  SettingsGroup,
  SettingsRow,
  SettingsSection,
  useModals,
  YStack,
} from '@session/ui'

import { useExportLogs } from '../useExportLogs'
import { confirmLink } from './confirmLink'
import { KEYBOARD_SHORTCUTS_SCREEN, KeyboardShortcutsPage } from './KeyboardShortcutsPage'

/**
 * `feedback` goes to `URLS.survey`, not `URLS.feedback`, matching the shipping clients so support
 * answers about "the feedback link" hold on both.
 */
const LINKS = [
  { name: 'faq', label: 'helpFAQ', description: 'helpFAQDescription', url: URLS.faq },
  {
    name: 'translate',
    label: 'translate',
    description: 'helpTranslateSessionDescription',
    url: URLS.translate,
  },
  { name: 'feedback', label: 'feedback', description: 'feedbackDescription', url: URLS.survey },
  { name: 'support', label: 'helpSupport', description: 'supportDescription', url: URLS.support },
] as const

/**
 * Help: report a bug, four links, and the keyboard shortcuts where the app has any. A child screen;
 * the settings modal supplies the chrome.
 */
export function HelpPage() {
  const modals = useModals()
  const logs = useExportLogs()
  const shortcuts = requirePorts().window.keyboardShortcuts

  return (
    <YStack padding="$md" gap="$lg">
      <YStack>
        <SettingsSection label={tr('logs')} />
        <SettingsGroup>
          <SettingsRow
            label={tr('helpReportABug')}
            // The copy says what the button does: saves a file on desktop, shares one on a phone.
            subtitle={tr(
              requirePorts().logs.deliversBy === 'saveDialog'
                ? 'helpReportABugExportLogsSaveToDesktopDescription'
                : 'helpReportABugExportLogsDescription',
            )}
            wideTrailing
            trailing={
              <Button
                variant="outline"
                size="sm"
                // Disabled only in a build that cannot export at all.
                disabled={!logs.canExport}
                loading={logs.exporting}
                onPress={logs.start}
                testID={ELEMENT.help.exportLogs}
              >
                {tr('helpReportABugExportLogs')}
              </Button>
            }
            testID={ELEMENT.help.reportABug}
          />
        </SettingsGroup>
      </YStack>

      <YStack>
        <SettingsSection label={tr('links')} />
        <SettingsGroup>
          {LINKS.map((link) => (
            <SettingsRow
              key={link.name}
              label={tr(link.label)}
              subtitle={tr(link.description)}
              leadsTo="outside"
              testID={ELEMENT.help.link(link.name)}
              onPress={() => {
                confirmLink(modals, link.url)
              }}
            />
          ))}
        </SettingsGroup>
      </YStack>

      {shortcuts === null ? null : (
        <SettingsGroup>
          <SettingsRow
            label={tr('keyboardShortcuts')}
            // The command that opens it, so the row teaches it too.
            trailing={
              <KeyCombo
                keys={['mod', 'slash']}
                names={shortcuts.keyNames}
                testID={ELEMENT.keyboardShortcuts.combo('help', 0)}
              />
            }
            leadsTo="screen"
            testID={ELEMENT.help.keyboardShortcuts}
            onPress={() => {
              modals.push({
                id: KEYBOARD_SHORTCUTS_SCREEN,
                title: tr('keyboardShortcuts'),
                render: () => <KeyboardShortcutsPage names={shortcuts.keyNames} />,
              })
            }}
          />
        </SettingsGroup>
      )}
    </YStack>
  )
}
