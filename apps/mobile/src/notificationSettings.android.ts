import type { NotificationsPort } from '@session/app'
import type { IncomingNotification } from '@session/client'
import type { SessionStore } from '@session/state'
import { requireOptionalNativeModule } from 'expo'

interface SessionPushModule {
  setSoundWhenOpen(on: boolean): void
  notificationsAllowed(): Promise<boolean>
  openNotificationSettings(): void
  openChannelSettings(channel: string): void
  backgroundAllowed(): Promise<boolean>
  changeBackground(): void
  preview(title: string, body: string): void
  post(notification: IncomingNotification): void
  remove(ids: readonly string[]): void
}

const SessionPush = requireOptionalNativeModule<SessionPushModule>('SessionPush')

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
  | 'post'
  | 'remove'
  | 'setBadgeCount'
>

/** Android's part of the Notifications page, through `modules/session-push`. */
export const notificationSettings: NotificationSettings =
  SessionPush === null
    ? {
        soundWhenOpenDefault: true,
        notificationsAllowed: null,
        openSettings: null,
        openChannelSettings: null,
        backgroundActivity: null,
        backgroundRefreshOn: null,
        playSound: null,
        preview: null,
        onTap: () => () => undefined,
        post: null,
        remove: null,
        setBadgeCount: () => Promise.resolve(),
      }
    : {
        soundWhenOpenDefault: true,
        notificationsAllowed: () => SessionPush.notificationsAllowed(),
        openSettings: () => {
          SessionPush.openNotificationSettings()
        },
        openChannelSettings: (channel) => {
          SessionPush.openChannelSettings(channel)
        },
        backgroundActivity: {
          allowed: () => SessionPush.backgroundAllowed(),
          change: () => {
            SessionPush.changeBackground()
          },
        },
        backgroundRefreshOn: null,
        // Each channel has its own sound, set in Android's settings.
        playSound: null,
        preview: ({ title, body }) => {
          SessionPush.preview(title, body)
          return Promise.resolve()
        },
        // Android opens a tapped conversation through the app's own link: see PushMessages.kt.
        onTap: () => () => undefined,
        // Posted as a push's notification is, in the words the push handler holds.
        post: (notification) => {
          SessionPush.post(notification)
        },
        remove: (ids) => {
          SessionPush.remove(ids)
        },
        // No count on Android's launcher icon, as legacy Android has none.
        setBadgeCount: () => Promise.resolve(),
      }

/**
 * Keeps the native push handler's copy of "sound when app is open" in step with the store: it posts
 * notifications without JavaScript.
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
