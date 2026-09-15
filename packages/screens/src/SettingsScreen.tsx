import { tr } from '@session/localization'
import { useAccount } from '@session/state'
import { useState } from 'react'
import { ELEMENT } from '@session/test-ids'
import { Button, Screen, Separator, Text, XStack, YStack } from '@session/ui'

import { requirePorts } from '@session/app'

import { AttachmentCacheSection } from './AttachmentCacheSection'
import { BackButton } from './BackButton'

/**
 * Settings, which for now is the account.
 *
 * The account ID is here because it is the one piece of state a person has to be able to read
 * off the screen: it is what someone else needs in order to write to this device, and until
 * onboarding grows a QR code it is the only way to hand it over.
 */
export function SettingsScreen() {
  const account = useAccount()
  const [copied, setCopied] = useState(false)

  // Not a fallback string, because there is no honest one. This screen exists to hand somebody
  // their account ID; with no account there is nothing to show and no reason to be here, and a
  // route that reaches it has gone wrong upstream. Throwing says which route, at the moment it
  // happens - a placeholder would draw a settings screen that quietly lies about having an
  // account, and somebody would read it out.
  if (account?.sessionId === undefined)
    throw new Error('SettingsScreen: no account. Onboarding has to run before this route.')

  // Named, because the check above does not narrow inside a callback: `account` comes from a hook
  // and could in principle be a different object by the time one runs.
  const sessionId = account.sessionId

  return (
    <Screen padded testID={ELEMENT.settings.screen}>
      <XStack alignItems="center" gap="$1.5">
        <BackButton testID={ELEMENT.settings.back} />
        <Text size="$6" weight="bold">
          {tr('sessionSettings')}
        </Text>
      </XStack>

      <YStack paddingVertical="$2" gap="$0.5">
        <Text tone="secondary" size="$2">
          {tr('accountId')}
        </Text>
        <XStack alignItems="center" gap="$1">
          <Text
            testID={ELEMENT.settings.accountId}
            // Wraps rather than truncates: a session ID that is cut off is not one you can
            // read out to somebody, which is the only reason it is on screen.
            flex={1}
          >
            {sessionId}
          </Text>
        </XStack>
        {/* A button rather than tappable text: the account ID is the one thing on this screen a
            person has to get out of the app, so the control needs a real hit area on a phone and
            has to say that it worked. */}
        <Button
          variant="outline"
          size="sm"
          testID={ELEMENT.settings.copyAccountId}
          onPress={() => {
            void requirePorts()
              .clipboard.setString(sessionId)
              .then(() => {
                // Confirmed on the button itself because no screen here has a toast surface to
                // put it on yet.
                setCopied(true)
                setTimeout(() => {
                  setCopied(false)
                }, 2000)
              })
          }}
        >
          {copied ? tr('copied') : tr('copy')}
        </Button>
      </YStack>

      <Separator borderColor="$bordersColor" />

      <YStack paddingVertical="$2" gap="$0.5">
        <Text tone="secondary" size="$2">
          {tr('networkName')}
        </Text>
        {/* The network this build talks to, which it knows from its own configuration whether or
            not libsession has attached yet. `enable` and `unknown` were standing in for a status
            the catalogue has no words for, and both read as a fault on a build that is working. */}
        <Text testID={ELEMENT.settings.networkStatus}>{requirePorts().network.name}</Text>
      </YStack>

      <Separator borderColor="$bordersColor" />

      <AttachmentCacheSection />
    </Screen>
  )
}
