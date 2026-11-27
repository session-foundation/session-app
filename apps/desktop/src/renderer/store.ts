import { followFlagToggles, followNotifications, requirePorts } from '@session/app'
import { createSessionClient } from '@session/client'
import { subscribeLocale, tr } from '@session/localization'
import { createSessionStore } from '@session/state'

import { notificationQueue } from './platform'
import { startLogging, storeLog } from './logs'
import { HOLD_AFTER_CONNECT_MS } from './notificationQueue'
import { createPortTransport } from './portTransport'

/**
 * The renderer's client, built on the port the preload handed over.
 *
 * The import from `./platform` above does more than bring its queue: it installs the OS ports as
 * a side effect, and this module reads them at import time. Making it the first import is what
 * guarantees they exist by then, whatever order the bundler settles on.
 */

const client = createSessionClient(createPortTransport())

/** A desktop has disk to spare, and a transcript full of pictures is what fills it. */
const ATTACHMENT_CACHE_LIMIT_BYTES = 5_000_000_000

export const store = createSessionStore(client, {
  attachmentCacheLimitBytes: ATTACHMENT_CACHE_LIMIT_BYTES,
  // To the log files main keeps, and to the console in development, which reaches the terminal
  // when Electron is run with --enable-logging and the DevTools console otherwise.
  log: storeLog,
  timers: { setTimeout, clearTimeout },
})

followFlagToggles(store)

followNotifications({
  store,
  client,
  notifications: requirePorts().notifications,
  // Nothing while the window has focus, as legacy desktop does: main decides, knowing OS focus.
  shouldPost: () => true,
})
// Held after each connect, as legacy desktop holds back: what arrives first is the catching up.
let connected = false
store.subscribe((state) => {
  const now = state.networkStatus === 'connected'
  if (now && !connected) notificationQueue.holdFor(HOLD_AFTER_CONNECT_MS)
  connected = now
})

const tellYou = () => {
  void client.setNotificationYou(tr('you'))
}
tellYou()
subscribeLocale(tellYou)

void startLogging(store).catch((error: unknown) => {
  console.error('[logs] could not start logging:', error)
})
