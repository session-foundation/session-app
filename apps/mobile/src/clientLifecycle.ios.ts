import type { SessionClient } from '@session/client'
import { type EventSubscription, requireOptionalNativeModule } from 'expo'
import { AppState } from 'react-native'

import { BackgroundTask } from './backgroundTask'
import { closeClientInBackground, type OpenHolds } from './backgroundClose'
import { logWriter, storeLog } from './logs'

const SessionPush = requireOptionalNativeModule<{
  addListener(event: 'onExtensionStored', listener: () => void): EventSubscription
}>('SessionPush')

function closeOnBackground(client: SessionClient, readAgain: () => void): OpenHolds {
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

/**
 * iOS closes the database whenever the app leaves the screen: see `closeClientInBackground`.
 * `readAgain` reads again what the Client could not announce: after a reopen, and whenever the
 * notification extension stores a message, which the app's own receive then finds already there.
 */
export function followAppLifecycle(client: SessionClient, readAgain: () => void): OpenHolds {
  const holds = closeOnBackground(client, readAgain)
  // Read once the app is in front, whatever state the signal came in: inactive (under Notification
  // Centre or a system prompt) is not a reopen, and nor is a return before the close began. A
  // return that did reopen reads a second time, which costs a few reads and misses nothing.
  let queued = false
  SessionPush?.addListener('onExtensionStored', () => {
    if (queued) return
    queued = true
    void holds.onceInFront(() => {
      queued = false
      readAgain()
      return Promise.resolve()
    })
  })
  return holds
}
