import { requirePorts, URLS, useDebugMode, useNav, routes } from '@session/app'
import { PENDING_COPY, toPlainText, tr } from '@session/localization'
import {
  useAccount,
  useNetworkStatus,
  useRecoveryPasswordHidden,
  useSessionActions,
} from '@session/state'
import { ELEMENT } from '@session/test-ids'
import {
  Button,
  ProBadge,
  RecoveryPasswordShield,
  SessionTokenMark,
  SettingsGroup,
  SettingsNote,
  SettingsRow,
  StatusDot,
  Text,
  useModals,
  YStack,
  type SettingsRowProps,
  type Modals,
} from '@session/ui'
import { useState } from 'react'

import { AccountHeader } from './AccountHeader'
import { confirmLink } from './confirmLink'
import { ConversationsPage } from './ConversationsPage'
import { HelpPage } from './HelpPage'
import { openRecoveryPassword } from './RecoveryPasswordPage'
import { SessionInfo } from './SessionInfo'
import { endAfterClear } from '../endAfterClear'
import { LocalizedText } from '../LocalizedText'
import { pathStatusLabel, pathStatusTone } from '../pathStatus'

/**
 * Off the size scale on purpose: a brand badge sized to sit level with the row's icons. At 16 its
 * width crowds the label. Wider than the icon column, which it overhangs.
 */
const PRO_BADGE = 14.5

/** One row of the root list, as `SettingsRow` takes it. */
type RowSpec = Pick<
  SettingsRowProps,
  | 'label'
  | 'icon'
  | 'onPress'
  | 'accentIcon'
  | 'destructive'
  | 'trailing'
  | 'trailingYields'
  | 'wideTrailing'
> & {
  testID: string
}

/** Secondary text in place of a row, which says why the row is not there. */
type NoteSpec = { note: string; testID: string }

/** Asks before deleting everything on the device, on top of the settings modal. */
function confirmClearData(modals: Modals, clear: () => Promise<void>): void {
  const id = modals.present({
    kind: 'alert',
    testID: ELEMENT.settings.confirmClearData,
    // No cross: somebody deciding whether to erase their account should read the word Cancel.
    // The scrim and Escape still leave, as on desktop.
    showClose: false,
    initial: {
      title: tr('clearDataAll'),
      render: () => (
        <LocalizedText text={tr('clearDeviceDescription')} size="$body" textAlign="center" />
      ),
      footer: () => <ClearDataActions modals={modals} id={id} clear={clear} />,
    },
  })
}

/** Locked while the clear runs, so nothing can look like a cancel of what is already happening. */
function ClearDataActions({
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
        testID={ELEMENT.settings.confirmClearDataButton}
        onPress={() => {
          setRunning(true)
          modals.lock(id)
          // A failure is shown by the startup-failure screen: the store sets it as the reason.
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
        testID={ELEMENT.settings.cancelClearData}
        onPress={() => {
          modals.dismiss(id)
        }}
      >
        {tr('cancel')}
      </Button>
    </>
  )
}

/**
 * The landing screen of the settings modal: the account, then five unheaded groups of rows.
 *
 * Child screens are pushed onto this modal rather than opening their own, so back returns here.
 * A disabled row is one whose screen is not built yet.
 */
export function SettingsRootPage() {
  const account = useAccount()
  const actions = useSessionActions()
  const modals = useModals()
  const nav = useNav()
  const networkStatus = useNetworkStatus()

  // No fallback: without an account there is no honest ID to show, so the caller is at fault.
  if (account?.sessionId === undefined)
    throw new Error('SettingsRootPage: no account. Onboarding has to run before this opens.')

  const sessionId = account.sessionId
  const name = account.displayName ?? ''
  const shareText = requirePorts().share.shareText
  const debugMode = useDebugMode()
  const recoveryPasswordHidden = useRecoveryPasswordHidden()

  const row = ELEMENT.settings.row
  // Rows without `onPress` draw disabled: their screens are not built yet.
  const groups: Array<Array<RowSpec | NoteSpec>> = [
    [
      {
        label: tr('upgradeSession'),
        icon: <ProBadge size={PRO_BADGE} color="$textDisabled" />,
        testID: row('pro'),
      },
      // Only where there is a share sheet to send the invitation through.
      ...(shareText === null
        ? []
        : [
            {
              label: tr('sessionInviteAFriend'),
              icon: 'userRoundPlus',
              testID: row('invite'),
              onPress: () => {
                // Plain text with its paragraphs: the ID and the link on lines of their own.
                void shareText(toPlainText(tr('accountIdShare', { account_id: sessionId })))
              },
            } satisfies RowSpec,
          ]),
    ],
    [
      {
        label: tr('donate'),
        icon: 'heart',
        accentIcon: true,
        testID: row('donate'),
        onPress: () => {
          confirmLink(modals, URLS.donationsApp)
        },
      },
      // The path's live state, as a dot named in words. TODO: open the path screen, which needs
      // the nodes of the current path that libsession's `get_path_to` has and the bridge does not
      // carry yet.
      {
        label: tr('onionRoutingPath'),
        icon: (
          <StatusDot tone={pathStatusTone(networkStatus)} testID={ELEMENT.settings.pathStatus} />
        ),
        // The state qualifies the row's name, so it is what truncates in a language where the two
        // do not fit side by side; at the accessibility sizes it goes under the name instead.
        trailingYields: true,
        wideTrailing: true,
        trailing: (
          <Text size="$body" tone="secondary" numberOfLines={1}>
            {pathStatusLabel(networkStatus)}
          </Text>
        ),
        testID: row('onion-path'),
      },
      { label: tr('networkName'), icon: SessionTokenMark, testID: row('network') },
    ],
    [
      { label: tr('sessionPrivacy'), icon: 'lockKeyhole', testID: row('privacy') },
      { label: tr('sessionNotifications'), icon: 'volume', testID: row('notifications') },
      {
        label: tr('sessionConversations'),
        icon: 'messageSquare',
        testID: row('conversations'),
        onPress: () => {
          modals.push({ title: tr('sessionConversations'), render: () => <ConversationsPage /> })
        },
      },
      { label: tr('sessionAppearance'), icon: 'paintbrush', testID: row('appearance') },
      {
        label: tr('sessionMessageRequests'),
        icon: 'messageSquareWarning',
        testID: row('message-requests'),
        // Leaves rather than descends: the requests list is a route of its own.
        onPress: () => {
          modals.dismissAll()
          nav.push(routes.requests())
        },
      },
      { label: tr('preferences'), icon: 'settings', testID: row('preferences') },
    ],
    [
      // Gone once hidden on this device, as on every legacy client, with a line saying so in its
      // place: people who hid it write in asking where it went.
      ...(recoveryPasswordHidden
        ? [
            {
              note: PENDING_COPY.recoveryPasswordHiddenOnDevice,
              testID: row('recovery-password-hidden'),
            } satisfies NoteSpec,
          ]
        : [
            {
              label: tr('sessionRecoveryPassword'),
              icon: RecoveryPasswordShield,
              testID: row('recovery-password'),
              onPress: () => {
                openRecoveryPassword(modals, actions)
              },
            } satisfies RowSpec,
          ]),
      {
        label: tr('sessionHelp'),
        icon: 'circleHelp',
        testID: row('help'),
        onPress: () => {
          modals.push({ title: tr('sessionHelp'), render: () => <HelpPage /> })
        },
      },
      // Shown once debug mode is on, which is how turning it on is seen to have worked.
      ...(debugMode
        ? [
            {
              label: tr('developerSettings'),
              icon: 'settings',
              testID: row('developer-settings'),
            } satisfies RowSpec,
          ]
        : []),
      {
        label: tr('sessionClearData'),
        icon: 'trash',
        destructive: true,
        testID: ELEMENT.settings.clearData,
        onPress: () => {
          // The process ends once the clear is done: see `endAfterClear`.
          // TODO: iOS closes rather than relaunching, which can read as a crash. Say so in the
          // confirm once the catalogue has a string for it.
          confirmClearData(modals, () => actions.clearDeviceData().then(endAfterClear))
        },
      },
    ],
  ]

  return (
    <YStack paddingHorizontal="$md" paddingBottom="$md" gap="$lg">
      <AccountHeader sessionId={sessionId} name={name} />
      {groups.map((rows) => (
        <SettingsGroup key={rows[0]?.testID}>
          {rows.map((spec) =>
            'note' in spec ? (
              <SettingsNote key={spec.testID} text={spec.note} testID={spec.testID} />
            ) : (
              <SettingsRow key={spec.testID} {...spec} disabled={spec.onPress === undefined} />
            ),
          )}
        </SettingsGroup>
      ))}

      <SessionInfo />
    </YStack>
  )
}

/** Opens settings over whatever is on screen. */
export function useOpenSettings(): () => void {
  const modals = useModals()
  return () => {
    modals.present({
      initial: { title: tr('sessionSettings'), render: () => <SettingsRootPage /> },
    })
  }
}
