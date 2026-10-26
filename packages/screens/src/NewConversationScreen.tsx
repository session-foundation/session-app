import { routes, useNav } from '@session/app'
import { tr } from '@session/localization'
import { useSessionActions } from '@session/state'
import { ELEMENT } from '@session/test-ids'
import { Button, Input, Screen, Text, XStack, YStack } from '@session/ui'

import { BackButton } from './BackButton'
import { useTopBarInsets } from './shell/pane'
import { useState } from 'react'

/**
 * Starting a conversation from an account ID.
 *
 * The only way to write to somebody who has not written first - until this existed, sending
 * could only happen by replying to a message request, which is half of a messenger.
 *
 * There is no QR scanner and no contact list yet, so this is a field and a button. libsession
 * validates the id and says what is wrong with it, which is a better message than anything
 * this screen could invent.
 */
export function NewConversationScreen() {
  const topBarInsets = useTopBarInsets()
  const actions = useSessionActions()
  const nav = useNav()
  const [accountId, setAccountId] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)

  function start(): void {
    if (accountId.trim().length === 0 || busy) return
    setBusy(true)
    setFailed(null)
    actions
      .startConversation(accountId)
      .then((id) => {
        // Replace rather than push: coming back to a filled-in form after opening the
        // conversation it created is not somewhere anybody wants to be.
        nav.replace(routes.conversation(id))
      })
      .catch((error: unknown) => {
        setFailed(error instanceof Error ? error.message : String(error))
        setBusy(false)
      })
  }

  return (
    <Screen padded testID={ELEMENT.newConversation.screen}>
      <YStack gap="$sm">
        {/* The way out in one pane, where this screen covers the list. Beside the list the list
            is the way out, and the back control draws nothing. */}
        <XStack alignItems="center" gap="$sm" {...topBarInsets}>
          <BackButton testID={ELEMENT.newConversation.back} />
          <Text size="$title" weight="bold">
            {tr('conversationsNew')}
          </Text>
        </XStack>
        {/* The desktop wording of the pair, on both platforms, because it is the one that does
            not promise a QR scanner - and this screen has none yet. When the scanner lands,
            mobile wants `messageNewDescriptionMobile` instead. */}
        <Text tone="secondary" size="$label">
          {tr('messageNewDescriptionDesktop')}
        </Text>

        <Input
          value={accountId}
          onChangeText={setAccountId}
          placeholder={tr('accountIdEnter')}
          autoCapitalize="none"
          testID={ELEMENT.newConversation.accountIdInput}
          onSubmit={start}
        />

        <Button testID={ELEMENT.newConversation.start} disabled={busy} onPress={start}>
          {busy ? tr('loading') : tr('next')}
        </Button>

        {failed === null ? null : (
          <Text tone="danger" size="$caption" testID={ELEMENT.newConversation.error}>
            {failed}
          </Text>
        )}
      </YStack>
    </Screen>
  )
}
