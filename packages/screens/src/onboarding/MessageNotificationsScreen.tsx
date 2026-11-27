import { requirePorts } from '@session/app'
import { PENDING_COPY, tr } from '@session/localization'
import type { DeliveryMode } from '@session/state'
import { ELEMENT } from '@session/test-ids'
import { Button, RadioIndicator, Text, XStack, YStack } from '@session/ui'
import { useState } from 'react'

import {
  deliveryModeDescription,
  deliveryModeTitle,
  deliveryOffers,
  recommendedMode,
} from '../deliveryModes'
import { OnboardingStep } from './OnboardingStep'

interface MessageNotificationsScreenProps {
  onBack: () => void
  onContinue: (mode: DeliveryMode) => void
  busy?: boolean
}

/** The 24 is the gutter between the box and the radio, which sits outside it. */
const BOX_PADDING_X = 16
const BOX_PADDING_Y = 12
const TEXT_GAP = 8
const ROW_GAP = 24

interface NotificationOptionProps {
  value: DeliveryMode
  title: string
  description: string
  /** A further line, as Instant's about communities. */
  note: string | null
  badge: string | null
  selected: boolean
  disabled: boolean
  onSelect: (mode: DeliveryMode) => void
}

/**
 * **A bordered box with a radio beside it, and no fill.** Both clients draw it this way: a border
 * around the text only, and the radio outside it in a 24pt gutter to the trailing side, centred
 * against the whole text block rather than against the title. Neither fills the box, and neither
 * changes it on selection -- the dot is the entire signal.
 */
function NotificationOption({
  value,
  title,
  description,
  note,
  badge,
  selected,
  disabled,
  onSelect,
}: NotificationOptionProps) {
  return (
    <XStack
      role="radio"
      aria-checked={selected}
      alignItems="center"
      gap={ROW_GAP}
      pointerEvents={disabled ? 'none' : 'auto'}
      $platform-web={{ cursor: 'pointer' }}
      onPress={() => {
        onSelect(value)
      }}
      testID={ELEMENT.onboarding.notificationsOption(value)}
    >
      <YStack
        flex={1}
        gap={TEXT_GAP}
        paddingHorizontal={BOX_PADDING_X}
        paddingVertical={BOX_PADDING_Y}
        borderRadius="$md"
        borderWidth={1}
        borderColor="$bordersColor"
      >
        {/* Dimmed by colour rather than by fading the row, so an unavailable option still reads
            as a box rather than a smudge. */}
        <Text size="$bodyLarge" weight="bold" {...(disabled ? { tone: 'disabled' as const } : {})}>
          {title}
        </Text>
        <Text size="$label" {...(disabled ? { tone: 'disabled' as const } : {})}>
          {description}
        </Text>
        {note === null ? null : (
          <Text size="$label" tone={disabled ? 'disabled' : 'secondary'}>
            {note}
          </Text>
        )}
        {badge === null ? null : (
          <Text size="$body" weight="bold" tone={disabled ? 'secondary' : 'accent'}>
            {badge}
          </Text>
        )}
      </YStack>
      <RadioIndicator selected={selected} disabled={disabled} />
    </XStack>
  )
}

/**
 * How new messages reach the device: every delivery mode this platform offers.
 *
 * The last screen of the create sequence, and **the point at which the account is actually made**
 * -- everything before it was collected and held. It comes before the restore wait rather than
 * after, so that a restore is not fifteen seconds of nothing followed by a question.
 *
 * The same list as the Message delivery settings screen. A mode this build or device cannot use is
 * shown disabled with the reason rather than hidden: Instant is the recommended choice everywhere
 * it exists, and quietly dropping it makes the others look like the only design rather than the
 * fallback. The first usable mode is preselected, so the button is never one that cannot be used.
 */
export function MessageNotificationsScreen({
  onBack,
  onContinue,
  busy = false,
}: MessageNotificationsScreenProps) {
  const notifications = requirePorts().notifications
  const offers = deliveryOffers(notifications)
  const recommended = recommendedMode(offers)
  const [mode, setMode] = useState<DeliveryMode>(recommended ?? 'while-open')

  return (
    <OnboardingStep
      title={tr('notificationsMessage')}
      description={PENDING_COPY.messageDeliveryDescription}
      onBack={onBack}
      // A back press while the account is being made, or discarded, starts a second one.
      backDisabled={busy}
      testID={ELEMENT.onboarding.notificationsScreen}
      // The options end in a bordered box and there is no message to hold room for, so nothing
      // else would keep the button off it.
      footerGap
      footer={
        <Button
          variant="outlineAccent"
          testID={ELEMENT.onboarding.continueButton}
          loading={busy}
          onPress={() => {
            onContinue(mode)
          }}
        >
          {tr('theContinue')}
        </Button>
      }
    >
      <YStack gap="$sm">
        {offers.map((offer) => {
          const usable = offer.unavailable === null
          return (
            <NotificationOption
              key={offer.mode}
              value={offer.mode}
              title={deliveryModeTitle(offer.mode, notifications.pushService)}
              description={deliveryModeDescription(offer, notifications.pushService)}
              note={
                offer.mode === 'instant' && usable ? PENDING_COPY.deliveryInstantCommunities : null
              }
              badge={
                !usable ? tr('unavailable') : offer.mode === recommended ? tr('recommended') : null
              }
              selected={mode === offer.mode}
              disabled={!usable}
              onSelect={setMode}
            />
          )
        })}
      </YStack>
    </OnboardingStep>
  )
}
