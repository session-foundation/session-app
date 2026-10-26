import { requirePorts, URLS, useDebugMode, useNav, routes } from '@session/app'
import { toPlainText, tr } from '@session/localization'
import { useAccount, useSessionActions } from '@session/state'
import { ELEMENT } from '@session/test-ids'
import {
  Avatar,
  Button,
  LABEL_MAX_SCALE,
  ProBadge,
  RecoveryPasswordShield,
  SessionTokenMark,
  SettingsGroup,
  SettingsRow,
  Text,
  useModals,
  XStack,
  YStack,
  type SettingsRowProps,
  type Modals,
} from '@session/ui'
import { useState } from 'react'

import { AccountIdControls } from './AccountIdControls'
import { confirmLink } from './confirmLink'
import { ConversationsPage } from './ConversationsPage'
import { HelpPage } from './HelpPage'
import { SessionInfo } from './SessionInfo'
import { endAfterClear } from '../endAfterClear'
import { LocalizedText } from '../LocalizedText'

/**
 * Off the size scale on purpose: a brand badge sized to sit level with the row's icons. At 16 its
 * width crowds the label. Wider than the icon column, which it overhangs.
 */
const PRO_BADGE = 14.5

/** One row of the root list, as `SettingsRow` takes it. */
type RowSpec = Pick<
  SettingsRowProps,
  'label' | 'icon' | 'onPress' | 'accentIcon' | 'destructive'
> & {
  testID: string
}

const PROFILE_AVATAR = 90

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

/** "Your Account ID" in a pill between two rules. */
function AccountIdPill() {
  return (
    <XStack alignSelf="stretch" alignItems="center">
      <YStack flex={1} height={1} backgroundColor="$bordersColor" />
      <YStack
        paddingTop="$2xs"
        paddingBottom="$2xs"
        paddingHorizontal="$sm"
        borderRadius="$full"
        borderWidth={1}
        borderColor="$bordersColor"
      >
        <Text
          size="$body"
          tone="secondary"
          userSelect="none"
          maxFontSizeMultiplier={LABEL_MAX_SCALE}
        >
          {tr('accountIdYours')}
        </Text>
      </YStack>
      <YStack flex={1} height={1} backgroundColor="$bordersColor" />
    </XStack>
  )
}

/**
 * The account, above the rows. The ID is what someone needs to message this account, so it wraps
 * rather than truncates, with a copy control beside it; on desktop the ID copies when pressed too.
 */
function AccountHeader({ sessionId, name }: { sessionId: string; name: string }) {
  return (
    <YStack
      alignItems="center"
      gap="$sm"
      // No bottom padding: the page's gap already separates the ID from the first group.
      paddingTop="$lg"
    >
      <Avatar id={sessionId} name={name} size={PROFILE_AVATAR} />
      {name === '' ? null : (
        <Text
          size="$headingLarge"
          weight="bold"
          maxFontSizeMultiplier={LABEL_MAX_SCALE}
          testID={ELEMENT.settings.displayName}
        >
          {name}
        </Text>
      )}
      <AccountIdPill />
      <AccountIdControls sessionId={sessionId} />
    </YStack>
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

  // No fallback: without an account there is no honest ID to show, so the caller is at fault.
  if (account?.sessionId === undefined)
    throw new Error('SettingsRootPage: no account. Onboarding has to run before this opens.')

  const sessionId = account.sessionId
  const name = account.displayName ?? ''
  const shareText = requirePorts().share.shareText
  const debugMode = useDebugMode()

  const row = ELEMENT.settings.row
  // Rows without `onPress` draw disabled: their screens are not built yet.
  const groups: RowSpec[][] = [
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
      // The live onion-path icon and path modal both wait on the path screen.
      { label: tr('onionRoutingPath'), icon: 'info', testID: row('onion-path') },
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
      {
        label: tr('sessionRecoveryPassword'),
        icon: RecoveryPasswordShield,
        testID: row('recovery-password'),
      },
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
          {rows.map((spec) => (
            <SettingsRow key={spec.testID} {...spec} disabled={spec.onPress === undefined} />
          ))}
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
