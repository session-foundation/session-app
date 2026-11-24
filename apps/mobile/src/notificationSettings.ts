import type { NotificationsPort } from '@session/app'
import type { SessionStore } from '@session/state'
import { type EventSubscription, requireOptionalNativeModule } from 'expo'
import { Linking } from 'react-native'

interface SessionPushModule {
  notificationsAllowed(): Promise<boolean>
  backgroundRefreshOn(): Promise<boolean>
  setSoundWhenOpen(on: boolean): void
  preview(title: string, body: string): Promise<void>
  addListener(event: 'onTap', listener: (tap: { conversation: string }) => void): EventSubscription
}

const SessionPush = requireOptionalNativeModule<SessionPushModule>('SessionPush')

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
  | 'onTap'
>

/** iOS's part of the Notifications page, through `modules/session-push`. */
export const notificationSettings: NotificationSettings = {
  soundWhenOpenDefault: true,
  notificationsAllowed: SessionPush === null ? null : () => SessionPush.notificationsAllowed(),
  // iOS opens the app's own page in Settings, which is where its notification switches are.
  openSettings: () => {
    void Linking.openSettings()
  },
  openChannelSettings: null,
  backgroundActivity: null,
  backgroundRefreshOn: SessionPush === null ? null : () => SessionPush.backgroundRefreshOn(),
  // Each sound's file is named for it. `none` has no file, so plays nothing, as it will on arrival.
  playSound:
    NotificationSounds === null
      ? null
      : (sound) => {
          if (sound !== 'none') NotificationSounds.play(sound)
        },
  preview: SessionPush === null ? null : ({ title, body }) => SessionPush.preview(title, body),
  // A tap on a message notification, by conversation. Android opens it through the app's link
  // instead, so this is iOS's alone.
  onTap: (handler) => {
    if (SessionPush === null) return () => undefined
    const subscription = SessionPush.addListener('onTap', ({ conversation }) =>
      handler(conversation),
    )
    return () => {
      subscription.remove()
    }
  },
}

/**
 * Keeps the native presenter's copy of "sound when app is open" in step with the store: iOS asks it
 * how to show a notification while the app is in front.
 */
export function followNotificationPrefs(store: SessionStore): void {
  if (SessionPush === null) return
  let last: boolean | null = null
  const apply = () => {
    const on = store.getState().soundWhenOpen ?? notificationSettings.soundWhenOpenDefault
    if (on === last) return
    last = on
    SessionPush.setSoundWhenOpen(on)
  }
  apply()
  store.subscribe(apply)
}
