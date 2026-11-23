import {
  DEVELOPER_COPY,
  DEVELOPER_FLAGS,
  changedSinceLaunch,
  flag,
  flagSource,
  requirePorts,
  type DeveloperFlag,
  type FlagName,
  type FlagSource,
} from '@session/app'
import { tr } from '@session/localization'
import { useFlagToggles, useSessionActions } from '@session/state'
import { ELEMENT } from '@session/test-ids'
import {
  Button,
  SettingsGroup,
  SettingsRow,
  SettingsSection,
  Switch,
  Text,
  useModals,
  XStack,
  YStack,
  type ModalScreen,
} from '@session/ui'

/** A listed flag as it stands now. */
interface DeveloperFlagState {
  flag: DeveloperFlag
  value: boolean
  source: FlagSource
}

export interface DeveloperSettingsContentProps {
  flags: readonly DeveloperFlagState[]
  /** Anything besides debug mode is switched, so there is something to put back. */
  canReset: boolean
  onDebugModeOff: () => void
  onFlagChange: (name: FlagName, value: boolean) => void
  onReset: () => void
}

/**
 * Says a restart is needed, with Restart where the platform can relaunch (`onRestart` null where it
 * cannot). Pinned above every Developer Settings screen; see `developerScreen`.
 */
export function DeveloperRestartBanner({ onRestart }: { onRestart: (() => void) | null }) {
  return (
    <YStack paddingHorizontal="$md" paddingTop="$md">
      <SettingsGroup>
        <XStack
          backgroundColor="$backgroundSecondary"
          alignItems="center"
          gap="$sm"
          padding="$md"
          testID={ELEMENT.developerSettings.restartBanner}
        >
          <YStack flex={1}>
            <Text size="$label" color="$warningColor">
              {tr('settingsRestartDescription')}
            </Text>
          </YStack>
          {onRestart === null ? null : (
            <Button size="sm" onPress={onRestart} testID={ELEMENT.developerSettings.restart}>
              {tr('restart')}
            </Button>
          )}
        </XStack>
      </SettingsGroup>
    </YStack>
  )
}

/**
 * The banner while a listed flag read only at start differs from what the app started with, and
 * nothing otherwise. Reads the switches itself, so it comes and goes as they change.
 */
function PendingRestart() {
  useFlagToggles()
  const pending = DEVELOPER_FLAGS.some(
    (listed) => listed.restartRequired && changedSinceLaunch(listed.name),
  )
  return pending ? <DeveloperRestartBanner onRestart={requirePorts().window.restart} /> : null
}

/**
 * A Developer Settings screen, for pushing onto the settings modal: the restart banner is its
 * header, so it stays in view however far the screen scrolls and on every child screen pushed this
 * way, and appears nowhere outside Developer Settings.
 */
export function developerScreen(screen: Omit<ModalScreen, 'header'>): ModalScreen {
  return { ...screen, header: () => <PendingRestart /> }
}

/**
 * Developer Settings as drawn from what it is given: debug mode alone at the top, as legacy iOS has
 * its developer mode, then every listed flag with what it does and how it stands now.
 */
export function DeveloperSettingsContent({
  flags,
  canReset,
  onDebugModeOff,
  onFlagChange,
  onReset,
}: DeveloperSettingsContentProps) {
  return (
    <YStack padding="$md" gap="$lg" testID={ELEMENT.developerSettings.page}>
      <SettingsGroup>
        <SettingsRow
          label={DEVELOPER_COPY.debugModeTitle}
          subtitle={DEVELOPER_COPY.debugModeDescription}
          trailing={
            <Switch
              value
              onValueChange={(on) => {
                if (!on) onDebugModeOff()
              }}
              accessibilityLabel={DEVELOPER_COPY.debugModeTitle}
              testID={ELEMENT.developerSettings.debugModeSwitch}
            />
          }
          testID={ELEMENT.developerSettings.debugMode}
        />
      </SettingsGroup>
      <YStack>
        <SettingsSection label={DEVELOPER_COPY.featureFlags} />
        <SettingsGroup>
          {flags.map(({ flag: listed, value, source }) => (
            <SettingsRow
              key={listed.name}
              label={listed.title}
              subtitle={listed.description}
              details={[
                {
                  label: DEVELOPER_COPY.currentLabel,
                  value: DEVELOPER_COPY.currentValue(value, source),
                },
              ]}
              trailing={
                <Switch
                  value={value}
                  onValueChange={(next) => onFlagChange(listed.name, next)}
                  accessibilityLabel={listed.title}
                  testID={ELEMENT.developerSettings.flagSwitch(listed.name)}
                />
              }
              testID={ELEMENT.developerSettings.flag(listed.name)}
            />
          ))}
        </SettingsGroup>
      </YStack>
      <SettingsGroup>
        <SettingsRow
          label={DEVELOPER_COPY.resetFlags}
          disabled={!canReset}
          onPress={onReset}
          testID={ELEMENT.developerSettings.resetFlags}
        />
      </SettingsGroup>
    </YStack>
  )
}

/**
 * Developer Settings: debug mode, and a switch for each listed flag, which wins over the
 * environment and starts at whatever the flag is now, so one turned on by its environment variable
 * shows as on. Switches are stored with the account. Shown only in debug mode, which turning off
 * here puts every switch back and leaves the screen, as legacy iOS's developer mode does.
 */
export function DeveloperSettingsPage() {
  const actions = useSessionActions()
  const modals = useModals()
  // Read so the page redraws when a switch is stored; the values themselves come from `flag`.
  const toggles = useFlagToggles()
  const debugToggle = toggles['debugMode']
  return (
    <DeveloperSettingsContent
      flags={DEVELOPER_FLAGS.map((listed) => ({
        flag: listed,
        value: flag(listed.name),
        source: flagSource(listed.name),
      }))}
      canReset={Object.keys(toggles).some((name) => name !== 'debugMode')}
      onDebugModeOff={() => {
        // Stored off rather than cleared, so it stays off where the environment turns it on.
        void actions.replaceFlagToggles({ debugMode: false }).then(() => modals.back())
      }}
      onFlagChange={(name, value) => void actions.setFlagToggle(name, value)}
      onReset={() =>
        void actions.replaceFlagToggles(debugToggle === undefined ? {} : { debugMode: debugToggle })
      }
    />
  )
}
