import type { SessionClient } from '@session/client'
import { AppState } from 'react-native'

import { BackgroundTask } from './backgroundTask'
import { closeClientInBackground, type WhileOpen } from './backgroundClose'
import { logWriter, storeLog } from './logs'

/** iOS closes the database whenever the app leaves the screen: see `closeClientInBackground`. */
export function followAppLifecycle(client: SessionClient): WhileOpen {
  const task = BackgroundTask
  if (task === null) {
    storeLog('error', 'lifecycle', 'no background task module: the database stays open')
    return (run) => run()
  }
  return closeClientInBackground({
    client,
    onAppStateChange: (listener) => {
      AppState.addEventListener('change', listener)
    },
    initialState: AppState.currentState ?? 'unknown',
    task,
    log: (level, message) => {
      storeLog(level, 'lifecycle', message)
    },
    flushLog: () => logWriter.then((writer) => writer.flush(true)),
  })
}
