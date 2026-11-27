import type { SessionClient } from '@session/client'

import type { OpenHolds } from './backgroundClose'

/**
 * Nothing outside iOS: the database stays open in the background. Only iOS kills a suspended app
 * for the locks it holds (`clientLifecycle.ios.ts`).
 */
export function followAppLifecycle(_client: SessionClient, _onReopened: () => void): OpenHolds {
  return { whileOpen: (run) => run(), onceInFront: (run) => run() }
}
