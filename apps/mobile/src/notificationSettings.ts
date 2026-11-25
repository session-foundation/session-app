import type { NotificationsPort } from '@session/app'
import type { IncomingNotification, SessionClient } from '@session/client'
import type { SessionStore } from '@session/state'
import { type EventSubscription, requireOptionalNativeModule } from 'expo'
import { Linking } from 'react-native'

import type { WhileOpen } from './backgroundClose'

interface SessionPushModule {
  notificationsAllowed(): Promise<boolean>
  backgroundRefreshOn(): Promise<boolean>
  setSoundWhenOpen(on: boolean): void
  setSound(name: string): void
  preview(title: string, body: string): Promise<void>
  post(notification: IncomingNotification): void
  remove(ids: readonly string[]): void
  setBadgeCount(count: number): Promise<void>
  finishAction(token: string, done: boolean): void
  addListener(
    event: 'onTap',
    listener: (tap: { conversation: string | null; message: number | null }) => void,
  ): EventSubscription
  addListener(event: 'onAction', listener: (action: NotificationAction) => void): EventSubscription
}

/** A notification's Mark read or Reply, which iOS hands the app to carry out. */
interface NotificationAction {
  token: string
  conversation: string
  action: 'markRead' | 'reply'
  reply?: string
}

/** How long a reply is given to reach the swarm, inside the time iOS allows an action. */
const REPLY_DEADLINE_MS = 20_000

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
  | 'post'
  | 'remove'
  | 'setBadgeCount'
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
  // A tap on a message notification, by conversation and message, or on a request's, by null. Android opens
  // both through the app's own link instead, so this is iOS's alone.
  onTap: (handler) => {
    if (SessionPush === null) return () => undefined
    const subscription = SessionPush.addListener('onTap', ({ conversation, message }) => {
      handler(
        conversation === null
          ? { kind: 'requests' }
          : { kind: 'conversation', conversationId: conversation, messageId: message ?? undefined },
      )
    })
    return () => {
      subscription.remove()
    }
  },
  // Posted as the extension posts a push's, in the words the app group holds.
  post: SessionPush === null ? null : (notification) => SessionPush.post(notification),
  remove: SessionPush === null ? null : (ids) => SessionPush.remove(ids),
  setBadgeCount: (count) => SessionPush?.setBadgeCount(count) ?? Promise.resolve(),
}

/**
 * Keeps the native side's copies of the notification settings in step with the store: the presenter
 * asks "sound when app is open" how to show a notification while the app is in front, and the
 * extension reads the sound from the app group, so a push it cannot open the database for still
 * plays the one chosen.
 */
export function followNotificationPrefs(store: SessionStore): void {
  if (SessionPush === null) return
  let lastOn: boolean | null = null
  let lastSound: string | null = null
  const apply = () => {
    const state = store.getState()
    const on = state.soundWhenOpen ?? notificationSettings.soundWhenOpenDefault
    if (on !== lastOn) {
      lastOn = on
      SessionPush.setSoundWhenOpen(on)
    }
    // Null without an account, when there is nothing to notify about.
    const sound = state.notificationSound
    if (sound !== null && sound !== lastSound) {
      lastSound = sound
      SessionPush.setSound(sound)
    }
  }
  apply()
  store.subscribe(apply)
}

/** Whether message `id` reaches the swarm before `timeoutMs`: false once it fails, or then. */
function sent(
  client: Pick<SessionClient, 'onEvent'>,
  id: Promise<number>,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    // Listening before the id is known: the states after the send can arrive before it resolves.
    const seen = new Map<number, string>()
    let messageId: number | null = null
    const settle = (result: boolean) => {
      clearTimeout(timer)
      stop()
      resolve(result)
    }
    const check = () => {
      const state = messageId === null ? undefined : seen.get(messageId)
      if (state === 'sent') settle(true)
      else if (state !== undefined && state !== 'pending' && state !== 'sending') settle(false)
    }
    const stop = client.onEvent((event) => {
      if (event.type !== 'messages-updated') return
      for (const message of event.messages) seen.set(message.id, message.sendState)
      check()
    })
    const timer = setTimeout(() => settle(false), timeoutMs)
    id.then(
      (known) => {
        messageId = known
        check()
      },
      () => settle(false),
    )
  })
}

/**
 * Carries out Mark read and Reply from a message's notification with the app's own Client: iOS
 * wakes the app for them, and holds the action open until it is told it is over. A reply marks the
 * conversation read too, as legacy iOS's does, and counts as done once it has reached the swarm.
 *
 * The app is usually off the screen with its database closed when the action arrives, so the work
 * runs through `whileOpen`, which opens it for the action and closes it again after.
 */
export function followNotificationActions(
  client: Pick<SessionClient, 'markRead' | 'sendMessage' | 'onEvent'>,
  whileOpen: WhileOpen,
): void {
  if (SessionPush === null) return
  SessionPush.addListener('onAction', ({ token, conversation, action, reply }) => {
    const run = async (): Promise<boolean> => {
      await client.markRead(conversation)
      if (action !== 'reply' || reply === undefined) return true
      return sent(client, client.sendMessage(conversation, { body: reply }), REPLY_DEADLINE_MS)
    }
    void whileOpen(run)
      .catch(() => false)
      .then((done) => {
        SessionPush.finishAction(token, done)
      })
  })
}
