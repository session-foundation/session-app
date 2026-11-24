import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Frame } from '@session/bridge-types'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createNodeBridgeTransport } from '#src/index'

/**
 * Which way a database keeps SQLite's header. iOS makes its database with the header in plaintext,
 * for its shared container; the notification extension, and any platform the database is moved
 * to, has to open it the same way, or the open fails as "file is not a database".
 *
 * Skipped when the addon has not been built, as the per-PR job does not build it.
 */
const addon = join(import.meta.dirname, '../build/Release/session_bridge_node.node')
const describeAddon = existsSync(addon) ? describe : describe.skip

const SQLITE_HEADER = 'SQLite format 3\0'

function head(path: string): string {
  return readFileSync(path).subarray(0, 16).toString('latin1')
}

describeAddon('the database header', () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'session-header-'))
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  /** Opens the database, asks for the account, and closes it: the error, or undefined. */
  async function openOnce(dbPath: string, plaintextHeaderWhenNew: boolean) {
    const transport = createNodeBridgeTransport({
      dbPath,
      cacheDir: join(dir, 'cache'),
      rawKey: new Uint8Array(32).fill(9),
      deferAccount: false,
      plaintextHeaderWhenNew,
    })
    const answered = new Promise<Frame>((resolve) => {
      transport.setSink((frame) => {
        if (frame.type === 'response' && frame.response.id === 1) resolve(frame)
      })
    })
    transport.send({ id: 1, command: { type: 'getAccountInfo' } })
    const frame = await answered
    transport.close()
    if (frame.type !== 'response') throw new Error('no response frame')
    return frame.response.error
  }

  it('makes a plaintext header when asked, and opens it again without being asked', async () => {
    const path = join(dir, 'ios.db')
    expect(await openOnce(path, true)).toBeUndefined()
    expect(head(path)).toBe(SQLITE_HEADER)
    // As the extension, or another platform, opens it.
    expect(await openOnce(path, false)).toBeUndefined()
    expect(head(path)).toBe(SQLITE_HEADER)
  })

  it('keeps an encrypted header where one was made, even when asked for a plaintext one', async () => {
    const path = join(dir, 'encrypted.db')
    expect(await openOnce(path, false)).toBeUndefined()
    expect(head(path)).not.toBe(SQLITE_HEADER)
    // An install made before iOS asked for the plaintext header.
    expect(await openOnce(path, true)).toBeUndefined()
    expect(head(path)).not.toBe(SQLITE_HEADER)
  })
})
