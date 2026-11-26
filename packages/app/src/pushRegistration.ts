import type { SessionClient } from '@session/client'
import type { SessionState } from '@session/state'

import type { PushInstallMarker, PushTokenSource } from './ports'

export interface PushRegistrationDeps {
  store: { getState(): SessionState; subscribe(listener: () => void): () => void }
  client: Pick<SessionClient, 'setPushToken' | 'clearPushToken'>
  source: PushTokenSource | null
  marker: PushInstallMarker | null
  /** Calls back whenever the app comes to the front; answers how to stop. */
  onActive: ((listener: () => void) => () => void) | null
  log: (level: 'info' | 'warn', message: string) => void
}

/**
 * Keeps this device's push subscription in step with the notification mode.
 *
 * In fast mode, once there is an account and a network, the token is fetched and handed to
 * libsession, which subscribes with the push server or does nothing when the stored subscription
 * already matches; an install's first subscription is sent whatever is stored (see
 * `PushInstallMarker`). In slow mode the subscription is removed. Run again whenever the mode, the
 * account or the token changes, whenever the network comes back after a refusal, so a registration
 * that failed offline is not left failed, and whenever the app comes to the front.
 *
 * Fast mode always calls through, rather than skipping a token it has already sent: libsession
 * renews a subscription that has aged only when it is handed the token, and the push server drops
 * one that is not renewed. A process can outlive that, and asking costs a database read when
 * nothing is due.
 *
 * One step at a time: a change arriving while one runs is applied after it.
 */
export function followPushRegistration(deps: PushRegistrationDeps): () => void {
  const { store, client, source, marker, onActive, log } = deps
  /** The mode last applied successfully, so that slow mode is not removed again on every step. */
  let applied: 'fast' | 'slow' | null = null
  let running = false
  let again = false

  const wanted = (): 'fast' | 'slow' | null => {
    const state = store.getState()
    if (state.account?.haveAccount !== true || state.notificationMode === null) return null
    return state.notificationMode
  }

  const apply = async (): Promise<void> => {
    const mode = wanted()
    if (mode === null) return
    if (mode === 'slow') {
      if (applied === 'slow') return
      await client.clearPushToken()
      applied = 'slow'
      log('info', 'push subscription removed for slow mode')
      return
    }
    if (source === null || store.getState().networkStatus !== 'connected') return
    const token = await source.token()
    if (token === null) {
      log('warn', 'fast mode, but no push token from this device')
      return
    }
    const force = marker !== null && !marker.subscribed()
    const sent = await client.setPushToken(token.service, token.token, force)
    if (force) marker.markSubscribed()
    applied = 'fast'
    if (sent)
      log(
        'info',
        `push subscription sent (${token.service}${force ? ', first since install' : ''})`,
      )
  }

  const run = (): void => {
    if (running) {
      again = true
      return
    }
    running = true
    void apply()
      .catch((error: unknown) => {
        log(
          'warn',
          `push registration failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      })
      .finally(() => {
        running = false
        if (again) {
          again = false
          run()
        }
      })
  }

  // Only what decides a step: the store changes with every message, and a step asks the OS for a
  // token.
  const trigger = (): string => {
    const state = store.getState()
    return `${String(state.account?.haveAccount)}|${String(state.notificationMode)}|${state.networkStatus}`
  }
  let lastTrigger = trigger()
  const unsubscribeStore = store.subscribe(() => {
    const now = trigger()
    if (now === lastTrigger) return
    lastTrigger = now
    run()
  })
  const unsubscribeToken = source?.onChange(run) ?? (() => {})
  const unsubscribeActive = onActive?.(run) ?? (() => {})
  run()
  return () => {
    unsubscribeStore()
    unsubscribeToken()
    unsubscribeActive()
  }
}
