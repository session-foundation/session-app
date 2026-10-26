import { CLIENT_URLS, requirePorts, URLS } from '@session/app'
import { tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'
import { PressArea, SessionTokenLogo, Text, useModals, XStack, YStack } from '@session/ui'
import { useState } from 'react'

import { confirmLink } from './confirmLink'
import { useDebugModePresses } from './debugModePresses'

const LOGO_HEIGHT = 20
/** Half strength until the pointer is on it. */
const RESTING = 0.5

/**
 * The foot of the settings page: the network's logo, then the version and the commit side by side.
 *
 * The logo leaves for the token site and the version for its release page, both through the usual
 * confirmation. Pressing the commit is how debug mode is turned over.
 */
export function SessionInfo() {
  const modals = useModals()
  const onCommitPress = useDebugModePresses()
  const { version, commit } = requirePorts().build
  // A fill, so it is set from state: a hover style reaches the frame, not the drawing inside it.
  const [logoHovered, setLogoHovered] = useState(false)

  return (
    <YStack alignItems="center" gap="$2xs">
      <PressArea
        accessibilityLabel={tr('networkName')}
        testID={ELEMENT.settings.tokenLogo}
        onPress={() => {
          confirmLink(modals, URLS.token)
        }}
      >
        {() => (
          <YStack
            $platform-web={{ cursor: 'pointer' }}
            onMouseEnter={() => {
              setLogoHovered(true)
            }}
            onMouseLeave={() => {
              setLogoHovered(false)
            }}
          >
            <SessionTokenLogo
              size={LOGO_HEIGHT}
              color={logoHovered ? '$textPrimary' : '$textSecondary'}
            />
          </YStack>
        )}
      </PressArea>

      <XStack gap="$xs">
        <PressArea
          testID={ELEMENT.settings.version}
          onPress={() => {
            confirmLink(modals, CLIENT_URLS.release(version))
          }}
        >
          {() => (
            <Text
              size="$label"
              opacity={RESTING}
              hoverStyle={{ opacity: 1 }}
              $platform-web={{ cursor: 'pointer' }}
            >
              {`v${version}`}
            </Text>
          )}
        </PressArea>
        {commit === null ? null : (
          <PressArea testID={ELEMENT.settings.commit} onPress={onCommitPress}>
            {() => (
              <Text
                size="$label"
                opacity={RESTING}
                hoverStyle={{ opacity: 1 }}
                $platform-web={{ cursor: 'pointer' }}
              >
                {commit}
              </Text>
            )}
          </PressArea>
        )}
      </XStack>
    </YStack>
  )
}
