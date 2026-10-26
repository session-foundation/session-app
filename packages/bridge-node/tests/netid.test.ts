import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createSessionClient } from '@session/client'
import { describe, expect, it } from 'vitest'

import { createNodeBridgeTransport } from '#src/index'

const addon = join(import.meta.dirname, '../build/Release/session_bridge_node.node')

const describeAddon = existsSync(addon) ? describe : describe.skip

describeAddon('attachNetwork with no account yet', () => {
  it('refuses a netid it cannot attach to instead of keeping it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'session-netid-'))
    await mkdir(join(dir, 'cache'), { recursive: true })
    const client = createSessionClient(
      createNodeBridgeTransport({
        dbPath: join(dir, 'session.db'),
        cacheDir: join(dir, 'cache'),
        rawKey: new Uint8Array(32).fill(5),
        deferAccount: true,
      }),
    )

    try {
      await expect(client.attachNetwork({ netid: 'devnet' })).rejects.toThrow(/seed node/)
      await expect(client.attachNetwork({ netid: 'nonsense' })).rejects.toThrow(
        /mainnet, testnet or devnet/,
      )
      // libsession dials a seed node itself and resolves no host names, so this never becomes an
      // address: refused where the field is still named rather than deep inside libquic.
      await expect(
        client.attachNetwork({
          netid: 'devnet',
          seedNodes: [
            {
              ed25519PubkeyHex: 'a'.repeat(64),
              ip: 'seed.devnet.test',
              httpsPort: 1300,
              omqPort: 1305,
            },
          ],
        }),
      ).rejects.toThrow(/IPv4/)

      // The devnet compose's file server, named by the X25519 key it prints beside the Ed25519
      // one: libsession would read it as Ed25519 and fail every upload.
      const seedNodes = [
        { ed25519PubkeyHex: 'a'.repeat(64), ip: '127.0.0.1', httpsPort: 1300, omqPort: 1305 },
      ]
      const fileServer = { scheme: 'http' as const, host: '127.0.0.1', port: 8000 }
      await expect(
        client.attachNetwork({
          netid: 'devnet',
          seedNodes,
          fileServer: {
            ...fileServer,
            ed25519PubkeyHex: '51bda59019c34e34c1dfcdf279b1c4e4da5cfc8c2cbb1e2942d443890ac8c43e',
          },
        }),
      ).rejects.toThrow(/not an Ed25519 key/)
      await expect(
        client.attachNetwork({
          netid: 'devnet',
          seedNodes,
          fileServer: { ...fileServer, ed25519PubkeyHex: 'a'.repeat(63) },
        }),
      ).rejects.toThrow(/64 hex characters/)

      // The refusal has to leave nothing behind. A netid kept here is one the next call that
      // brings an account into being throws on - onboarding failing at the step after the one
      // the user got wrong, naming a network nobody asked that screen about.
      await client.createAccount()
      const info = await client.getAccountInfo()
      expect(info.haveAccount).toBe(true)
      expect(info.networkAttached).toBe(false)
    } finally {
      client.close()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
