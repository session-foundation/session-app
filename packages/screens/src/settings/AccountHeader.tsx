import { tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'
import {
  Avatar,
  Button,
  Icon,
  LABEL_MAX_SCALE,
  logical,
  PressArea,
  Text,
  XStack,
  YStack,
} from '@session/ui'
import { useState } from 'react'

import { AccountIdControls } from './AccountIdControls'
import { ShareableQrCode } from './ShareableQrCode'

const PROFILE_AVATAR_PX = 90
/**
 * The enlarged display picture, and the QR code, which takes the same room so the page below
 * moves once rather than twice on the way from one to the other.
 */
const ENLARGED_PX = 190

/**
 * Where the QR badge sits on the display picture, as shares of its diameter. It comes in from the
 * corner as the picture grows, so it stays on the circle's edge rather than floating off it.
 */
const QR_BADGE_INSET = {
  resting: { top: 0.03, end: 0 },
  enlarged: { top: 0.04, end: 0.09 },
} as const

/** How far the back badge overhangs the code's corner. */
const BACK_BADGE_OVERHANG_PX = -15

/** A circle round the circle, for the keyboard. */
const AVATAR_RING = { onAccent: false, offset: 2, radius: '$full' } as const

type AccountHeaderView = 'avatar' | 'enlargedAvatar' | 'qr'

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

/** The primary-colour circle at the top-end corner of the picture or the code: swaps the two. */
function SwapBadge({
  icon,
  accessibilityLabel,
  testID,
  focusOnMount,
  onPress,
}: {
  icon: 'qrCode' | 'userRound'
  accessibilityLabel: string
  testID: string
  focusOnMount: boolean
  onPress: () => void
}) {
  return (
    <Button
      variant="solid"
      size="sm"
      circular
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      focusOnMount={focusOnMount}
      onPress={onPress}
      icon={<Icon name={icon} size="md" color="$onAccent" />}
    />
  )
}

/**
 * The account, above the rows: its display picture, or the QR code of its Account ID in the
 * picture's place, then the name and the ID. The ID is what someone needs to message this account,
 * so it wraps rather than truncates, with a copy control beside it; on desktop the ID copies when
 * pressed too.
 *
 * The name goes while the code shows: the code stands for the ID, which stays. The picture keeps
 * its size across a trip to the code and back.
 */
export function AccountHeader({
  sessionId,
  name,
  initialView = 'avatar',
}: {
  sessionId: string
  name: string
  /** Which the header opens on. For the catalog, which has no press to get to the other two. */
  initialView?: AccountHeaderView | undefined
}) {
  const [showingQr, setShowingQr] = useState(initialView === 'qr')
  const [enlarged, setEnlarged] = useState(initialView === 'enlargedAvatar')
  // Whether the picture and the code have swapped since the header was drawn: the badge that swaps
  // back takes the focus then, and only then, so opening Settings does not move it.
  const [swapped, setSwapped] = useState(false)
  const avatarPx = enlarged ? ENLARGED_PX : PROFILE_AVATAR_PX
  const inset = QR_BADGE_INSET[enlarged ? 'enlarged' : 'resting']

  return (
    <YStack
      alignItems="center"
      gap="$sm"
      // No bottom padding: the page's gap already separates the ID from the first group.
      paddingTop="$lg"
    >
      {showingQr ? (
        // `relative`: on the web a stack is static unless it says so, and the badge would sit at
        // the corner of whatever ancestor is positioned instead of the code's.
        <YStack position="relative">
          <ShareableQrCode
            value={sessionId}
            sizePx={ENLARGED_PX}
            accessibilityLabel={tr('qrCode')}
            testID={ELEMENT.settings.accountQr}
            fullScreenTestID={ELEMENT.settings.accountQrFullScreen}
          />
          <YStack
            position="absolute"
            top={BACK_BADGE_OVERHANG_PX}
            {...logical({ insetEnd: BACK_BADGE_OVERHANG_PX })}
          >
            <SwapBadge
              icon="userRound"
              // No catalogue string says "show the display picture"; this names what comes back.
              accessibilityLabel={tr('profileDisplayPicture')}
              testID={ELEMENT.settings.qrBack}
              focusOnMount={swapped}
              onPress={() => {
                setShowingQr(false)
                setSwapped(true)
              }}
            />
          </YStack>
        </YStack>
      ) : (
        <YStack position="relative">
          <PressArea
            accessibilityLabel={tr('profileDisplayPicture')}
            ring={AVATAR_RING}
            testID={ELEMENT.settings.avatar}
            onPress={() => {
              setEnlarged((was) => !was)
            }}
          >
            {() => (
              <YStack $platform-web={{ cursor: 'pointer' }}>
                <Avatar id={sessionId} name={name} size={avatarPx} />
              </YStack>
            )}
          </PressArea>
          <YStack
            position="absolute"
            top={avatarPx * inset.top}
            {...logical({ insetEnd: avatarPx * inset.end })}
          >
            <SwapBadge
              icon="qrCode"
              accessibilityLabel={tr('qrView')}
              testID={ELEMENT.settings.qrToggle}
              focusOnMount={swapped}
              onPress={() => {
                setShowingQr(true)
                setSwapped(true)
              }}
            />
          </YStack>
        </YStack>
      )}
      {name === '' || showingQr ? null : (
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
