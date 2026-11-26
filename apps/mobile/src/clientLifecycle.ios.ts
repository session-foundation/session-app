import type { SessionClient } from '@session/client'
import { type EventSubscription, requireOptionalNativeModule } from 'expo'
import { AppState } from 'react-native'

import { BackgroundTask } from './backgroundTask'
import { closeClientInBackground, type OpenHolds } from './backgroundClose'
import { logWriter, storeLog } from './logs'

const SessionPush = requireOptionalNativeModule<{
  addListener(event: 'onExtensionStored', listener: () => void): EventSubscription
}>('SessionPush')

/**
 * iOS closes the database whenever the app leaves the screen: see `closeClientInBackground`.
 * `readAgain` reads again what the Client could not announce: after a reopen, and whenever the
 * notification extension stores a message while the app is in front, which the app's own receive
 * then finds already there.
 */
export function followAppLifecycle(client: SessionClient, readAgain: () => void): OpenHolds {
  SessionPush?.addListener('onExtensionStored', () => {
    if (AppState.currentState === 'active') readAgain()
  })
  const task = BackgroundTask
  if (task === null) {
    storeLog('error', 'lifecycle', 'no background task module: the database stays open')
    return { whileOpen: (run) => run(), onceInFront: (run) => run() }
  }
  return closeClientInBackground({
    client,
    onAppStateChange: (listener) => {
      AppState.addEventListener('change', listener)
    },
    initialState: AppState.currentState ?? 'unknown',
    onReopened: readAgain,
    task,
    log: (level, message) => {
      storeLog(level, 'lifecycle', message)
    },
    flushLog: () => logWriter.then((writer) => writer.flush(true)),
  })
}
