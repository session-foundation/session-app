import { notificationWords, PENDING_COPY, tr } from '@session/localization'
import type { DeliveryMode } from '@session/state'
import type { NotificationContent, NotificationSound } from '@session/client'

export const CONTENT_CHOICES: readonly NotificationContent[] = [
  'nameAndContent',
  'nameOnly',
  'none',
]

export function contentLabel(content: NotificationContent): string {
  switch (content) {
    case 'nameAndContent':
      return tr('notificationsContentShowNameAndContent')
    case 'nameOnly':
      return tr('notificationsContentShowNameOnly')
    case 'none':
      return tr('notificationsContentShowNoNameOrContent')
  }
}

/** Desktop's longer wording for each choice, as legacy desktop shows under its radios. */
export function contentDescription(content: NotificationContent): string {
  switch (content) {
    case 'nameAndContent':
      return tr('notificationSenderNameAndPreview')
    case 'nameOnly':
      return tr('notificationSenderNameOnly')
    case 'none':
      return tr('notificationsGenericOnly')
  }
}

/**
 * What Preview Notification posts: what a message notification shows with `content`, as the push
 * handler would draw it.
 */
export function previewSample(content: NotificationContent): { title: string; body: string } {
  const { appName, generic } = notificationWords()
  if (content === 'none') return { title: appName, body: generic }
  if (content === 'nameOnly') return { title: tr('preview'), body: generic }
  return { title: tr('preview'), body: PENDING_COPY.previewNotificationBody }
}

/** In legacy iOS's order: no sound, then the default, then the rest by name. */
export const NOTIFICATION_SOUNDS: readonly NotificationSound[] = [
  'none',
  'note',
  'aurora',
  'bamboo',
  'chord',
  'circles',
  'complete',
  'hello',
  'input',
  'keys',
  'popcorn',
  'pulse',
  'synth',
]

export const DEFAULT_SOUND: NotificationSound = 'note'

export function soundName(sound: NotificationSound): string {
  return sound === 'none' ? tr('none') : PENDING_COPY.notificationSoundNames[sound]
}

/**
 * The mode in effect: Only while open until one is chosen, since without a choice nothing is
 * subscribed and nothing runs in the background.
 */
export function effectiveDeliveryMode(chosen: DeliveryMode | null): DeliveryMode {
  return chosen ?? 'while-open'
}

/** The background modes Android can pause to save battery, which the exemption is for. */
export function needsBackgroundActivity(mode: DeliveryMode | null): boolean {
  return mode === 'always-connected' || mode === 'periodic'
}
