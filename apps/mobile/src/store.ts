import {
  ALBUM_WIDTH,
  netidForTransport,
  parseDevnetConfig,
  parseLogSpec,
  parseNetworkName,
  parseRouterKind,
} from '@session/basic-types'
import { createRefusingTransport, type BridgeTransport, type FetchLike } from '@session/client'
import { createSessionStore } from '@session/state'
import { PixelRatio, Platform } from 'react-native'

import { mobileClient } from './client'
import { libsessionLog, storeLog, watchStore } from './logs'
import { resolveDatabaseKey } from './storage/databaseKey'
import { protectDatabase, sessionPaths } from './storage/roots'

/**
 * `fetch` with a deadline, because Hermes has no `AbortSignal.timeout` and a seed node that
 * silently drops the connection would otherwise hang the app before it drew anything.
 */
const timedFetch: FetchLike = (url, init) => {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, 8_000)
  return fetch(url, { ...init, signal: controller.signal }).finally(() => {
    clearTimeout(timer)
  })
}

/**
 * The mobile client.
 *
 * The Nitro module is reached through `@session/client`'s `.native` pair rather than imported
 * here: an app is an adapter, and which bridge it gets is the one decision this file makes.
 */
async function openTransport(): Promise<BridgeTransport> {
  // Metro inlines an env var into the bundle only when its name carries EXPO_PUBLIC_ and is
  // written out literally; a bare name, or one built from a prefix, reads `undefined` here
  // however the dev script was invoked. Drop the prefix and the fake check below falls through
  // silently, taking the Nitro module and real libsession on a run meant to be fake.
  if (process.env['EXPO_PUBLIC_SESSION_FAKE'] === '1') {
    const { createFakeBridge } = await import('./dev/fakeBridge')
    return createFakeBridge()
  }

  const name = parseNetworkName(process.env['EXPO_PUBLIC_SESSION_NETID'])
  const devnet =
    name === 'devnet'
      ? parseDevnetConfig(
          {
            seedUrl: process.env['EXPO_PUBLIC_SESSION_DEVNET_SEED_URL'],
            fileServerUrl: process.env['EXPO_PUBLIC_SESSION_FILE_SERVER_URL'],
            fileServerEd25519Pubkey: process.env['EXPO_PUBLIC_SESSION_FILE_SERVER_ED25519_PUBKEY'],
          },
          'EXPO_PUBLIC_SESSION_',
        )
      : undefined

  const netid = netidForTransport(name, devnet)
  const router = parseRouterKind(process.env['EXPO_PUBLIC_SESSION_ROUTER'])
  const logs = parseLogSpec(process.env['EXPO_PUBLIC_SESSION_LOG'])

  const { createNativeBridgeTransport, discoverSeedNodes } = await import('@session/client')
  const paths = sessionPaths(name)

  const seedNodes =
    devnet === undefined
      ? undefined
      : await discoverSeedNodes(devnet.seedUrl, {
          fetch: timedFetch,
          variable: 'EXPO_PUBLIC_SESSION_DEVNET_SEED_URL',
        })

  const transport = createNativeBridgeTransport({
    ...paths,
    rawKeyHex: await resolveDatabaseKey(),
    // Onboarding has to be asked. Without this libsession creates an account as the database
    // opens, and the first screen is a conversation list for an identity nobody chose.
    deferAccount: true,
    // Attached by the bridge once an account exists: on open if there is one already, and
    // after onboarding otherwise.
    // Unset means mainnet, and absent for a devnet nothing configured, which attaches nothing
    // rather than quietly attaching mainnet. See netidForTransport.
    ...(netid === undefined ? {} : { netid }),
    ...(seedNodes === undefined ? {} : { seedNodes }),
    ...(devnet?.fileServer === undefined ? {} : { fileServer: devnet.fileServer }),
    // Unset takes the netid's default: Session Router on the public networks, onion requests on a
    // devnet, which is the only thing a devnet can use.
    ...(router === undefined ? {} : { router }),
    deviceType: Platform.OS === 'ios' ? 'ios' : 'android',
    // A default: a stored edge (setThumbnailEdge) wins over this at every open.
    thumbnailEdgePx: Math.round(ALBUM_WIDTH * PixelRatio.get()),
    // Off unless asked for, as on desktop: libsession is chatty below warn, and the reason to turn
    // it up is always a specific failure. It is also the only place the network and the transport
    // actually chosen are reported, which no screen shows.
    ...(logs?.level === undefined ? {} : { logLevel: logs.level }),
    ...(logs === undefined || logs.categories.length === 0
      ? {}
      : { logCategories: logs.categories }),
  })
  // The bridge opens the database as it is made, so the files are there by now.
  for (const failure of protectDatabase(paths.dbPath)) {
    storeLog('warn', 'storage', `could not protect ${failure}`)
  }
  return transport
}

/**
 * A phone's disk is not a desktop's, and neither is its data plan. Small enough that a long
 * scroll through a picture-heavy conversation evicts rather than accumulates.
 */
const ATTACHMENT_CACHE_LIMIT_BYTES = 500_000_000

/**
 * The bridge, or one that refuses everything with why it could not be made. Either way there is a
 * store, so a bridge that will not start reaches the startup-failure screen rather than leaving the
 * launch screen up for good -- nothing waits on a promise that rejected with no one to hear it.
 */
async function openTransportOrRefusal(): Promise<BridgeTransport> {
  try {
    return await openTransport()
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    storeLog('error', 'session', `the bridge could not start: ${reason}`)
    return createRefusingTransport(reason)
  }
}

export const storePromise = openTransportOrRefusal().then((transport) => {
  const store = createSessionStore(mobileClient(transport), {
    attachmentCacheLimitBytes: ATTACHMENT_CACHE_LIMIT_BYTES,
    log: storeLog,
    libsessionLog,
  })
  watchStore(store)
  return store
})
