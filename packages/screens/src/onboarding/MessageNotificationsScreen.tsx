import { flag, type NotificationsPort, requirePorts } from '@session/app'
import { tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'
import { Button, RadioIndicator, Text, XStack, YStack } from '@session/ui'
import { useState } from 'react'

import { OnboardingStep } from './OnboardingStep'
import type { NotificationMode } from './flow'

interface MessageNotificationsScreenProps {
  onBack: () => void
  onContinue: (mode: NotificationMode) => void
  busy?: boolean
}

/** The 24 is the gutter between the box and the radio, which sits outside it. */
const BOX_PADDING_X = 16
const BOX_PADDING_Y = 12
const TEXT_GAP = 8
const ROW_GAP = 24

/**
 * The description of fast mode, by whose servers it would use.
 *
 * Three strings in the catalogue and only one of them is true of any given build -- an iOS build
 * saying "Google's notification Servers" is simply wrong, and it is what ours said. The fallback is
 * the unqualified one, for a build with no push service to name at all.
 */
function fastModeDescription(service: NotificationsPort['pushService']): string {
  if (service === 'apple') return tr('notificationsFastModeDescriptionIos')
  if (service === 'huawei') return tr('notificationsFastModeDescriptionHuawei')
  return tr('notificationsFastModeDescription')
}

interface NotificationOptionProps {
  value: NotificationMode
  title: string
  description: string
  badge: string | null
  selected: boolean
  disabled: boolean
  onSelect: (mode: NotificationMode) => void
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
 * Which way notifications arrive.
 *
 * The last screen of the create sequence, and **the point at which the account is actually made**
 * -- everything before it was collected and held. It comes before the restore wait rather than
 * after, so that a restore is not fifteen seconds of nothing followed by a question.
 *
 * Fast mode is push and slow mode is polling. Where the build has no push service the fast option
 * is shown and marked unavailable rather than hidden: it is the recommended choice everywhere it
 * exists, and quietly dropping it makes polling look like the only design rather than the fallback.
 */
export function MessageNotificationsScreen({
  onBack,
  onContinue,
  busy = false,
}: MessageNotificationsScreenProps) {
  // The flag is a way to look at the screen, not a second source of truth: see its entry in the
  // flag table for why the recommended state is otherwise unreachable on a development machine.
  const notifications = requirePorts().notifications
  const fastAvailable = notifications.fastModeAvailable || flag('forceFastModeAvailable')
  // Slow mode preselected where fast is unavailable, so the button is never the one that cannot
  // be used.
  const [mode, setMode] = useState<NotificationMode>(fastAvailable ? 'fast' : 'slow')

  return (
    <OnboardingStep
      title={tr('notificationsMessage')}
      description={tr('onboardingMessageNotificationExplanation')}
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
        <NotificationOption
          value="fast"
          title={tr('notificationsFastMode')}
          description={fastModeDescription(notifications.pushService)}
          badge={fastAvailable ? tr('recommended') : tr('unavailable')}
          selected={mode === 'fast'}
          disabled={!fastAvailable}
          onSelect={setMode}
        />
        <NotificationOption
          value="slow"
          title={tr('notificationsSlowMode')}
          description={tr('notificationsSlowModeDescription')}
          badge={null}
          selected={mode === 'slow'}
          disabled={false}
          onSelect={setMode}
        />
      </YStack>
    </OnboardingStep>
  )
}
