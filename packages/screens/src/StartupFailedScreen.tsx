import { requirePorts } from '@session/app'
import { tr } from '@session/localization'
import { useAccount, useSessionActions, useStartupClearable } from '@session/state'
import { ELEMENT } from '@session/test-ids'
import { Button, Icon, Screen, Text, useModals, XStack, YStack, type Modals } from '@session/ui'
import { useState } from 'react'

import { clearAfterStartupFailure } from './endAfterClear'
import { LocalizedText } from './LocalizedText'
import { TextButton } from './TextButton'
import { useCopyWithToast } from './useCopyWithToast'
import { useExportLogs } from './useExportLogs'

interface StartupFailedScreenProps {
  /** libsession's own words: the only thing on the screen that says which failure it was. */
  error: string
}

/**
 * The app could not start.
 *
 * **The second outcome of a launch.** Without it, a rejection between the app opening and
 * libsession answering is indistinguishable from a database still migrating: the launch screen
 * stays up and neither ever ends. Drawn in the default theme, which is what the launch screen was
 * drawn in -- the theme is a preference in the database that just failed to open.
 *
 * **Clearing is the only way forward offered**, and it leads to onboarding (through a relaunch if
 * an account had been loaded: see `clearAfterStartupFailure`), where somebody either starts again
 * or enters their recovery phrase. No Retry: what lands here is a request the open database
 * refused, and asking it again gets the same answer. Where the bridge itself could not be made
 * there is nothing to clear with, and Quit is all that is left.
 */
export function StartupFailedScreen({ error }: StartupFailedScreenProps) {
  const actions = useSessionActions()
  const modals = useModals()
  const close = requirePorts().window.close
  const logs = useExportLogs()
  const clearable = useStartupClearable()
  const accountLoaded = useAccount()?.haveAccount === true

  return (
    <Screen padded testID={ELEMENT.startupFailed.screen}>
      <YStack flex={1} alignItems="center" justifyContent="center" gap="$xl">
        <YStack maxWidth={420} gap="$md" alignItems="center">
          <Text size="$titleLarge" weight="bold" textAlign="center">
            {tr('theError')}
          </Text>
          {/* With no bridge nothing was opened, so it is not a database error. */}
          <LocalizedText
            text={clearable ? tr('databaseErrorGeneric') : tr('errorUnknown')}
            textAlign="center"
          />
          <FailureReason error={error} />
        </YStack>

        <YStack gap="$sm" width="100%" maxWidth={348}>
          {/* What the explanation above asks for. A spinner, and inert, while the export runs:
              seconds of native compression on a phone, then the share sheet. Left out where the
              build cannot export. */}
          {logs.canExport ? (
            <TextButton
              label={['helpReportABugExportLogs']}
              variant="outline"
              loading={logs.exporting}
              testID={ELEMENT.startupFailed.exportLogs}
              onPress={logs.start}
            />
          ) : null}
          {/* Not where there is no bridge to clear with: a Clear that is known to fail is a
              destructive-looking button that does nothing. */}
          {clearable ? (
            <TextButton
              label={['clearDevice']}
              variant="danger"
              testID={ELEMENT.startupFailed.clear}
              onPress={() => {
                confirmClear(modals, () =>
                  clearAfterStartupFailure(() => actions.clearDeviceData(), accountLoaded),
                )
              }}
            />
          ) : null}
          {close === null ? null : (
            <TextButton
              label={['quit']}
              variant="outline"
              testID={ELEMENT.startupFailed.quit}
              onPress={() => {
                close()
              }}
            />
          )}
        </YStack>
      </YStack>
    </Screen>
  )
}

/**
 * libsession's message, apart from the explanation and drawn quieter, with a control that copies
 * it. It is the only thing on this screen that differs between one failure and another, and it is
 * what support needs.
 */
function FailureReason({ error }: { error: string }) {
  const copyWithToast = useCopyWithToast()
  const copy = () => {
    copyWithToast(error)
  }
  return (
    <XStack alignItems="center" gap="$xs">
      <Text
        flexShrink={1}
        tone="secondary"
        size="$caption"
        textAlign="center"
        testID={ELEMENT.startupFailed.reason}
      >
        {error}
      </Text>
      <Button
        variant="ghost"
        size="xs"
        circular
        accessibilityLabel={tr('copy')}
        testID={ELEMENT.startupFailed.copyReason}
        onPress={copy}
        icon={<Icon name="copy" size="sm" color="$textSecondary" />}
      />
    </XStack>
  )
}

/** Asks before clearing, as every other destructive confirmation does: Clear beside Cancel. */
function confirmClear(modals: Modals, clear: () => Promise<void>): void {
  const id = modals.present({
    kind: 'alert',
    testID: ELEMENT.startupFailed.confirmClear,
    // No cross: somebody deciding whether to erase their account should read the word Cancel.
    showClose: false,
    initial: {
      title: tr('clearDevice'),
      render: () => (
        <LocalizedText text={tr('clearDeviceDescription')} size="$body" textAlign="center" />
      ),
      footer: () => <ClearActions modals={modals} id={id} clear={clear} />,
    },
  })
}

/** Locked while the clear runs, so nothing can look like a cancel of what is already happening. */
function ClearActions({
  modals,
  id,
  clear,
}: {
  modals: Modals
  id: string
  clear: () => Promise<void>
}) {
  const [running, setRunning] = useState(false)
  return (
    <>
      <Button
        variant="ghost"
        fill
        borderRadius="$none"
        destructive
        disabled={running}
        testID={ELEMENT.startupFailed.confirmClearButton}
        onPress={() => {
          setRunning(true)
          modals.lock(id)
          // A failure is shown by the screen itself: the store sets it as the reason.
          void clear()
            .catch(() => {})
            .finally(() => {
              modals.dismissAll()
            })
        }}
      >
        {tr('clear')}
      </Button>
      <Button
        variant="ghost"
        fill
        borderRadius="$none"
        disabled={running}
        testID={ELEMENT.startupFailed.cancelClear}
        onPress={() => {
          modals.dismiss(id)
        }}
      >
        {tr('cancel')}
      </Button>
    </>
  )
}
