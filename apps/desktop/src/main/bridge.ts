import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import electron from 'electron'

import {
  netidForTransport,
  parseDevnetConfig,
  parseNetworkName,
  parseLogSpec,
  parseRouterKind,
  thumbnailEdgePxFor,
} from '@session/basic-types'
import type { BridgeTransport, DecodePlanner, MediaSource } from '@session/client'
import { tr } from '@session/localization'
import type { NetworkSettings } from '@session/logging'

import { databasePaths, replaceDatabase, resolveDatabaseKey } from './databaseKey'

const { app, safeStorage, screen } = electron

/** What main serves the renderer from: the frames, the media scheme and the decode plans. */
export type Bridge = BridgeTransport & MediaSource & DecodePlanner

/**
 * The repo-root `.env`, for a build run out of the checkout.
 *
 * Here rather than in a dev script because the same values have to reach `electron-vite dev`,
 * `preview`, the e2e harness and a bare `electron out/main/index.js`, and this is the only code
 * all four run. An explicit environment variable wins, which is what lets the harness pin
 * EXPO_PUBLIC_SESSION_FAKE whatever a developer keeps in their file.
 */
function loadDotEnv(): void {
  if (app.isPackaged) return
  const file = fileURLToPath(new URL('../../../../.env', import.meta.url))
  if (existsSync(file)) process.loadEnvFile(file)
}

/**
 * A setting that only a development build may have an opinion about.
 *
 * **Every one of these is unset in a packaged build, whatever the environment says.** They
 * choose which network the app attaches to and whether it talks to libsession at all. The
 * dev-only module the fake lives in is bundled either way, so a dynamic import is not the
 * barrier it looks like -- this is.
 */
function developerSetting(name: string): string | undefined {
  return app.isPackaged ? undefined : process.env[name]
}

/** The network settings this run's bridge is opened with, for the log's startup block. */
export function networkSettings(): NetworkSettings {
  // The startup block can be written before the bridge is opened, so before it loads `.env`.
  loadDotEnv()
  return {
    fake: developerSetting('EXPO_PUBLIC_SESSION_FAKE') === '1',
    netid: developerSetting('EXPO_PUBLIC_SESSION_NETID'),
    router: developerSetting('EXPO_PUBLIC_SESSION_ROUTER'),
    devnetSeedUrl: developerSetting('EXPO_PUBLIC_SESSION_DEVNET_SEED_URL'),
    fileServerUrl: developerSetting('EXPO_PUBLIC_SESSION_FILE_SERVER_URL'),
    logSpec: developerSetting('EXPO_PUBLIC_SESSION_LOG'),
  }
}

/**
 * Where this run's database and attachments live: per network, under userData. Also read by the
 * log export, which measures what is there.
 */
export function sessionDataDir(): string {
  return join(
    app.getPath('userData'),
    parseNetworkName(developerSetting('EXPO_PUBLIC_SESSION_NETID')),
  )
}

/**
 * The startup-failure screen's clear, for a bridge that could not be made for want of its key:
 * see `replaceDatabase`. Then the bridge, on the new key.
 */
export async function replaceDatabaseAndCreateBridge(): Promise<Bridge> {
  replaceDatabase(sessionDataDir(), safeStorage)
  return createBridge()
}

/**
 * Opens the bridge the renderer talks to.
 *
 * Everything above this file sees frames either way. Rejects with a `DatabaseKeyError` when the
 * key cannot be had, which `replaceDatabaseAndCreateBridge` is the way past.
 */
export async function createBridge(): Promise<Bridge> {
  loadDotEnv()

  // Per network, so a devnet identity and a mainnet one can both exist and switching back loses
  // neither. libsession derives its own snode cache from the database's directory, which puts
  // that on the right side of the split too.
  const dir = sessionDataDir()

  if (developerSetting('EXPO_PUBLIC_SESSION_FAKE') === '1') {
    // The fake opens no database and needs no key. Asked to, it keeps one anyway, so key custody
    // and the clear past its failures can be driven end to end without the addon.
    if (developerSetting('EXPO_PUBLIC_SESSION_FAKE_KEY_CUSTODY') === '1') {
      mkdirSync(dir, { recursive: true })
      resolveDatabaseKey(dir, safeStorage)
    }
    const { createFakeBridge } = await import('./dev/fakeBridge')
    return createFakeBridge()
  }

  const { createNodeBridgeTransport } = await import('@session/bridge-node')
  const { discoverSeedNodes } = await import('@session/client')

  const name = parseNetworkName(developerSetting('EXPO_PUBLIC_SESSION_NETID'))
  const devnet =
    name === 'devnet'
      ? parseDevnetConfig(
          {
            seedUrl: developerSetting('EXPO_PUBLIC_SESSION_DEVNET_SEED_URL'),
            fileServerUrl: developerSetting('EXPO_PUBLIC_SESSION_FILE_SERVER_URL'),
            fileServerEd25519Pubkey: developerSetting(
              'EXPO_PUBLIC_SESSION_FILE_SERVER_ED25519_PUBKEY',
            ),
          },
          'EXPO_PUBLIC_SESSION_',
        )
      : undefined

  const netid = netidForTransport(name, devnet)
  const router = parseRouterKind(developerSetting('EXPO_PUBLIC_SESSION_ROUTER'))
  const logs = parseLogSpec(developerSetting('EXPO_PUBLIC_SESSION_LOG'))

  mkdirSync(dir, { recursive: true })
  // Before the seed nodes are asked for: a key that cannot be had fails the start at once.
  const rawKey = resolveDatabaseKey(dir, safeStorage)

  const seedNodes =
    devnet === undefined
      ? undefined
      : await discoverSeedNodes(devnet.seedUrl, {
          fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(8_000) }),
          variable: 'EXPO_PUBLIC_SESSION_DEVNET_SEED_URL',
        })

  if (devnet?.fileServer === undefined && name === 'devnet')
    console.warn(
      'EXPO_PUBLIC_SESSION_FILE_SERVER_URL is unset on a devnet build: attachments would upload to the mainnet file server.',
    )

  return createNodeBridgeTransport({
    ...databasePaths(dir),
    rawKey,
    // Onboarding has to be asked. Without this libsession creates an account as the database
    // opens, and the first screen the user sees is a conversation list for an identity nobody
    // chose.
    deferAccount: true,
    // The bridge attaches this once an account exists - on open if there already is one, and after
    // onboarding otherwise. EXPO_PUBLIC_SESSION_NETID picks it; unset means mainnet, and there is
    // deliberately no way to spell "offline" here: that is what EXPO_PUBLIC_SESSION_FAKE is for.
    ...(netid === undefined ? {} : { netid }),
    ...(seedNodes === undefined ? {} : { seedNodes }),
    ...(devnet?.fileServer === undefined ? {} : { fileServer: devnet.fileServer }),
    // Unset takes the netid's default: Session Router on the public networks, onion requests on a
    // devnet. EXPO_PUBLIC_SESSION_ROUTER moves a public network onto the other one, which is the
    // only way to exercise a transport we ship on a network that has it.
    ...(router === undefined ? {} : { router }),
    deviceType: 'desktop',
    notificationYou: tr('you'),
    // The densest connected display's, since thumbnails are never remade: one made too small stays
    // soft, one made too large only costs memory. A stored edge (setThumbnailEdge) wins over this.
    thumbnailEdgePx: thumbnailEdgePxFor(
      screen.getAllDisplays().map((display) => display.scaleFactor),
      'wide',
    ),
    // Off unless asked for: it is chatty at anything below warn, and the reason to turn it up is
    // always a specific failure. `warn,network=debug` is what a diagnosis looks like - a flat
    // `debug` buries it under quic and the router.
    ...(logs?.level === undefined ? {} : { logLevel: logs.level }),
    ...(logs === undefined || logs.categories.length === 0
      ? {}
      : { logCategories: logs.categories }),
  })
}
