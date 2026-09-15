import { createSessionClient } from '@session/client'
import { createSessionStore } from '@session/state'

import './platform'
import { createPortTransport } from './portTransport'

/**
 * The renderer's client, built on the port the preload handed over.
 *
 * `import './platform'` above is not decoration: it installs the OS ports as a side effect,
 * and this module reads them at import time. Making it the first import is what guarantees
 * they exist by then, whatever order the bundler settles on.
 */

const client = createSessionClient(createPortTransport())

/** A desktop has disk to spare, and a transcript full of pictures is what fills it. */
const ATTACHMENT_CACHE_LIMIT = 5_000_000_000

export const store = createSessionStore(client, {
  attachmentCacheLimit: ATTACHMENT_CACHE_LIMIT,
  // The renderer's console, which reaches the terminal when Electron is run with
  // --enable-logging and the DevTools console otherwise.
  log: (level, line) => {
    console[level](line)
  },
})
