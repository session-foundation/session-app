import { requirePorts, URLS } from '@session/app'
import { tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'
import {
  LABEL_MAX_SCALE,
  PressArea,
  SessionTokenLogo,
  Text,
  useGlyphScale,
  useModals,
  YStack,
} from '@session/ui'

import { confirmLink } from './confirmLink'
import { useDebugModePresses } from './debugModePresses'

/** At the default text size; it grows with the text as the settings icons do, to XXX Large. */
const LOGO_HEIGHT = 24

/**
 * The foot of the settings page: the network's logo, then the build on one line --
 * "Version 1.2.3 (45 - abcdef12)", from the catalogue's `updateVersion`. Pressing the line is how
 * debug mode is turned over.
 */
export function SessionInfo() {
  const modals = useModals()
  const onVersionPress = useDebugModePresses()
  const glyphScale = useGlyphScale()
  const { version, commit, buildNumber } = requirePorts().build
  const detail = [buildNumber, commit].filter((part) => part !== null).join(' - ')

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
          <SessionTokenLogo size={Math.round(LOGO_HEIGHT * glyphScale)} color="$textSecondary" />
        )}
      </PressArea>
      <PressArea testID={ELEMENT.settings.version} onPress={onVersionPress}>
        {() => (
          // Held at the label cap so it stays in proportion with the logo above it, which stops
          // growing sooner; a version line three times its size reads as unrelated to it.
          <Text
            size="$label"
            tone="secondary"
            textAlign="center"
            maxFontSizeMultiplier={LABEL_MAX_SCALE}
          >
            {tr('updateVersion', { version: detail === '' ? version : `${version} (${detail})` })}
          </Text>
        )}
      </PressArea>
    </YStack>
  )
}
