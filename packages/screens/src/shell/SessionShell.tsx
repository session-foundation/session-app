import { requirePorts } from '@session/app'
import { useAccount, useHydrated, useStartupError, useStartupFailureKind } from '@session/state'
import { useMemo, useState, type ReactNode } from 'react'

import { ConversationListScreen } from '../ConversationListScreen'
import { OnboardingFlow } from '../onboarding/OnboardingFlow'
import { StartingScreen } from '../StartingScreen'
import { StartupFailedScreen } from '../StartupFailedScreen'
import { KeyboardShortcutsCommand } from '../settings/KeyboardShortcutsCommand'
import { usePersistedLocale } from '../usePersistedLocale'
import { ActionRail } from './ActionRail'
import { AdaptiveShell } from './AdaptiveShell'
import { NoSelectionPane } from './NoSelectionPane'
import { RoutedConversationProvider } from './routedConversation'

interface SessionShellProps {
  detail: ReactNode
  /** Any route but the list: requests and new conversation are routed screens too. */
  hasDetail: boolean
  openConversationId: string | undefined
}

function ShellContent({ detail, hasDetail, openConversationId }: SessionShellProps) {
  const hydrated = useHydrated()
  const startupError = useStartupError()
  const startupFailureKind = useStartupFailureKind()
  const account = useAccount()
  const [onboarding, setOnboarding] = useState(false)
  const routed = useMemo(() => ({ id: openConversationId }), [openConversationId])
  // Here rather than at the root, which creates the store provider and so cannot read from it.
  usePersistedLocale()

  // Asked before `hydrated`, because both are false when a start has failed and only one of them
  // says so. The other order leaves the launch screen up over a failure that is already known.
  if (startupError !== null)
    return <StartupFailedScreen error={startupError} kind={startupFailureKind ?? 'transient'} />
  if (!hydrated) return <StartingScreen />

  // Onboarding takes the whole window rather than a pane: there is no list to sit beside it,
  // and there will not be one until it has minted an identity.
  // `|| onboarding` because an account appearing is not the same as onboarding being over: a
  // restore mints one the moment the phrase is accepted and still has a wait to sit through.
  if (account?.haveAccount !== true || onboarding)
    return <OnboardingFlow onRunningChange={setOnboarding} />

  return (
    <AdaptiveShell
      list={<ConversationListScreen openConversationId={openConversationId} />}
      detail={<RoutedConversationProvider value={routed}>{detail}</RoutedConversationProvider>}
      hasDetail={hasDetail}
      placeholder={<NoSelectionPane />}
      rail={<ActionRail />}
    />
  )
}

/**
 * Everything the app draws once its store exists: the startup failure, the launch screen,
 * onboarding, or the conversation list with the routed screen beside it.
 *
 * Each app hands over what its own router matched, because reading a route is the app's business
 * and never a screen's: the routed screen as `detail`, whether that is anything but the list, and
 * which conversation it is, if one. Which of one pane or two that becomes is `AdaptiveShell`'s
 * decision, so a phone, a tablet and the desktop window all go through here.
 */
export function SessionShell(props: SessionShellProps) {
  const shortcuts = requirePorts().window.keyboardShortcuts
  return (
    <>
      {shortcuts === null ? null : <KeyboardShortcutsCommand shortcuts={shortcuts} />}
      <ShellContent {...props} />
    </>
  )
}
