import type { PushTokenSource } from '@session/app'
import type { PushService } from '@session/client'
import { type EventSubscription, requireOptionalNativeModule } from 'expo'

interface SessionPushModule {
  /** Whether this build registered a push service at startup: FCM in a Play build made with one. */
  readonly available: boolean
  token(): Promise<{ service: PushService; token: string } | null>
  addListener(event: 'onTokenChange', listener: () => void): EventSubscription
}

const SessionPush = requireOptionalNativeModule<SessionPushModule>('SessionPush')

/**
 * The token source behind Instant delivery, from `modules/session-push`: APNs on iOS, FCM or
 * Huawei's push kit on Android. Null when the build has no push service behind it: an F-Droid or
 * website build, or a Play build made without Firebase's values.
 */
export const pushTokens: PushTokenSource | null =
  SessionPush === null || !SessionPush.available
    ? null
    : {
        token: () => SessionPush.token(),
        onChange: (listener) => {
          const subscription = SessionPush.addListener('onTokenChange', listener)
          return () => {
            subscription.remove()
          }
        },
      }
