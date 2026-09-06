import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createNodeBridgeTransport } from '@session/bridge-node'
import { createSessionClient } from '@session/client'
import { describe, expect, it } from 'vitest'

import { accountId } from './fixtures'

/**
 * The ceiling on a page of messages, which exists and is not documented anywhere.
 *
 * `load_attachments` in libsession builds `WHERE message IN (?, ?, ...)` with one placeholder per
 * message in the page - deliberately, so that a conversation view costs one query rather than one
 * per message. SQLite's SQLITE_MAX_VARIABLE_NUMBER is 32766, so a page above that fails outright
 * with "too many SQL variables" rather than returning fewer rows.
 *
 * Nobody asks for thirty thousand messages at once on purpose, so this is not urgent. It is a trap
 * for whoever eventually writes "load the whole conversation", and the failure names SQL rather
 * than anything about page sizes. Chunking the IN clause is the fix and it belongs upstream.
 */

const addon = join(
  import.meta.dirname,
  '../../../packages/bridge-node/build/Release/session_bridge_node.node',
)

const describeAddon = existsSync(addon) ? describe : describe.skip

describeAddon('the page-size ceiling', () => {
  it('serves 32766 messages and refuses 32767', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'session-limit-'))
    await mkdir(join(dir, 'cache'), { recursive: true })
    const client = createSessionClient(
      createNodeBridgeTransport({
        dbPath: join(dir, 'session.db'),
        cacheDir: join(dir, 'cache'),
        rawKey: new Uint8Array(32).fill(5),
        deferAccount: false,
      }),
    )

    try {
      await client.getAccountInfo()
      let a = 7
      const random = () => {
        a = (a * 1103515245 + 12345) & 0x7fffffff
        return a / 0x7fffffff
      }
      const id = await client.openDm(accountId(random))

      // One more than the limit, so both sides of the boundary are reachable.
      for (let i = 0; i < 32_767; i++) await client.sendMessage(id, { body: 'x' })

      const under = await client.getMessages(id, { limit: 32_766 })
      expect(under).toHaveLength(32_766)

      await expect(client.getMessages(id, { limit: 32_767 })).rejects.toThrow(
        /too many SQL variables/,
      )
    } finally {
      client.close()
      await rm(dir, { recursive: true, force: true })
    }
  }, 600_000)
})
