import type { PushTokenSource } from '@session/app'

/** No token source on iOS yet: APNs registration arrives with the notification extension. */
export const pushTokens: PushTokenSource | null = null
