import type { SessionState } from '@session/state'

export interface NotificationPermissionDeps {
  store: { getState(): SessionState; subscribe(listener: () => void): () => void }
  /** Asks to show notifications where the OS needs asking, and answers whether they may be. */
  requestPermission: () => Promise<boolean>
  log: (level: 'info' | 'warn', message: string) => void
}

/**
 * Asks to show notifications once there is an account and a delivery mode, at startup or when one
 * is first chosen, and again whenever the mode changes.
 *
 * Every mode shows notifications, not only Instant: Always connected, Periodic and Only while open
 * post them from the app itself. The OS asks the person only while nothing has been decided, so
 * asking again costs nothing once they have answered.
 */
export function followNotificationPermission(deps: NotificationPermissionDeps): () => void {
  const { store, requestPermission, log } = deps
  let asked: string | null = null

  const check = (): void => {
    const state = store.getState()
    if (state.account?.haveAccount !== true || state.deliveryMode === null) return
    if (asked === state.deliveryMode) return
    asked = state.deliveryMode
    requestPermission()
      .then((allowed) => {
        if (!allowed) log('warn', 'notifications are not allowed on this device')
      })
      .catch((error: unknown) => {
        log('warn', `could not ask to show notifications: ${String(error)}`)
      })
  }

  const unsubscribe = store.subscribe(check)
  check()
  return unsubscribe
}
