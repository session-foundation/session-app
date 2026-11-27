import type { NotificationsPort } from '@session/app'
import type { SessionStore } from '@session/state'
import { requireOptionalNativeModule } from 'expo'
import { Linking } from 'react-native'

interface NotificationSoundsModule {
  play(name: string): void
}

/** `modules/notification-sounds`, which bundles legacy iOS's sounds. */
const NotificationSounds =
  requireOptionalNativeModule<NotificationSoundsModule>('NotificationSounds')

type NotificationSettings = Pick<
  NotificationsPort,
  | 'soundWhenOpenDefault'
  | 'notificationsAllowed'
  | 'openSettings'
  | 'openChannelSettings'
  | 'backgroundActivity'
  | 'backgroundRefreshOn'
  | 'playSound'
  | 'preview'
  | 'post'
  | 'remove'
  | 'requestPermission'
>

/**
 * iOS's part of the Notifications page. The permission, Background App Refresh and the preview
 * need the notification work iOS has not had yet, so they are null for now and their rows absent.
 */
export const notificationSettings: NotificationSettings = {
  soundWhenOpenDefault: true,
  notificationsAllowed: null,
  // iOS opens the app's own page in Settings, which is where its notification switches are.
  openSettings: () => {
    void Linking.openSettings()
  },
  openChannelSettings: null,
  backgroundActivity: null,
  backgroundRefreshOn: null,
  // Each sound's file is named for it. `none` has no file, so plays nothing, as it will on arrival.
  playSound:
    NotificationSounds === null
      ? null
      : (sound) => {
          if (sound !== 'none') NotificationSounds.play(sound)
        },
  preview: null,
  // The notification work iOS has not had yet: see the module's comment.
  post: null,
  remove: null,
  requestPermission: () => Promise.resolve(true),
}

/** Nothing native to keep in step on iOS yet. */
export function followNotificationPrefs(_store: SessionStore): void {}
