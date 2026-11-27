import type { SessionClient } from '@session/client'
import { AppState } from 'react-native'

import { BackgroundTask } from './backgroundTask'
import { closeClientInBackground } from './backgroundClose'
import { logWriter, storeLog } from './logs'

/**
 * iOS closes the database whenever the app leaves the screen: see `closeClientInBackground`.
 * `onReopened` reads again what the closed Client could not announce.
 */
export function followAppLifecycle(client: SessionClient, onReopened: () => void): void {
  const task = BackgroundTask
  if (task === null) {
    storeLog('error', 'lifecycle', 'no background task module: the database stays open')
    return
  }
  closeClientInBackground({
    client,
    onAppStateChange: (listener) => {
      AppState.addEventListener('change', listener)
      // Unset only before the native module has said, which is not where an app can be in the
      // background.
      if (AppState.currentState) listener(AppState.currentState)
    },
    onReopened,
    task,
    log: (level, message) => {
      storeLog(level, 'lifecycle', message)
    },
    flushLog: () => logWriter.then((writer) => writer.flush(true)),
  })
}
