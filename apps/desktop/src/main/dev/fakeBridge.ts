import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { BridgeTransport, MediaSource } from '@session/client'
import { createFakeMediaSource, createFakeTransport, startDevFake } from '@session/client/fake'

/**
 * The folder of dev photographs the fake serves, filled by `pnpm fake-media:fetch`.
 *
 * Outside the repository on purpose: several megabytes of somebody else's photographs are not
 * something to commit. Unprefixed because it is a path on the host, read only by host processes -
 * this one, the fetch script and mobile's push script - and never by an app bundle.
 */
const MEDIA_DIR =
  process.env['SESSION_FAKE_MEDIA_DIR'] ?? join(homedir(), '.cache', 'session-app', 'dev-media')

/**
 * The bridge, backed by the fake.
 *
 * This is a dev entry and lives here so the boundary rules can say so: production code
 * never imports the fake, and the dynamic import in ../bridge.ts is what keeps it out of a
 * shipped bundle.
 */
export function createFakeBridge(): BridgeTransport & MediaSource {
  const { alice, served } = startDevFake(process.env, {
    has: (fileName) => existsSync(join(MEDIA_DIR, fileName)),
    where: `in ${MEDIA_DIR}`,
    fix: 'pnpm fake-media:fetch',
  })

  return {
    ...createFakeTransport(served),
    ...createFakeMediaSource(alice, (photo) => readFile(join(MEDIA_DIR, photo))),
  }
}
