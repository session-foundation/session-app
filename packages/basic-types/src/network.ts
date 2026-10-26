/**
 * Which Session network a build talks to.
 *
 * Here rather than beside the ports it is read through, because one of its three readers is
 * Electron's main process, which cannot import a package that pulls in React.
 */
export type NetworkName = 'mainnet' | 'testnet' | 'devnet' | 'fake'

/**
 * The three libsession knows, which is not the same list.
 *
 * `fake` is a Session network the way the others are -- it is what the app is talking to, and it
 * is the answer the overlay has to give -- but nothing is attached for it, so it is never a
 * `netid`. Keeping the two types apart is what stops a value that means "no libsession at all"
 * reaching the option that names a network for it.
 */
export type NetId = Exclude<NetworkName, 'fake'>

/**
 * Reads `EXPO_PUBLIC_SESSION_NETID` into a network name, for whoever is doing the reading.
 *
 * One function because every app has two readers that must not diverge: the transport, which
 * decides what libsession attaches to, and the overlay, which tells a person what that was. Parse
 * the variable twice and a build can attach to one network while the stamp names another.
 *
 * An unrecognised value is mainnet, because unset has to be and there is nothing better to do with
 * a typo.
 */
export function parseNetworkName(value: string | undefined): NetId {
  return value === 'testnet' || value === 'devnet' ? value : 'mainnet'
}

// Named by `@session/bridge-types` and used here, not re-exported: whoever needs one of these by
// name takes it from there. Declaring them here as well is what this replaced, and they cannot
// move the other way - nitrogen resolves `SessionBridgeOptions` by following its types and will
// not follow one across a package boundary, so bridge-types has to own them.
import type { FileServerConfig, RouterKind } from '@session/bridge-types'

/**
 * Which transport a build uses, from the environment.
 *
 * Unset takes the netid's default rather than forcing one, so nothing changes unless it is asked
 * for. An unrecognised value is unset, the same way an unrecognised netid is mainnet: there is
 * nothing better to do with a typo than the documented default.
 */
export function parseRouterKind(value: string | undefined): RouterKind | undefined {
  return value === 'onion-requests' || value === 'session-router' || value === 'direct'
    ? value
    : undefined
}

/** What a devnet build needs told beyond its name, none of which has a sensible default. */
export interface DevnetConfig {
  /** The seed node's oxend RPC, canonicalised to `http://host:port`. */
  seedUrl: string
  fileServer?: FileServerConfig
}

/** The raw strings a devnet build is configured with, read by each app under its own prefix. */
export interface DevnetEnv {
  seedUrl: string | undefined
  fileServerUrl: string | undefined
  fileServerEd25519Pubkey: string | undefined
}

const DEFAULT_SEED_RPC_PORT = 1280
const HEX64 = /^[0-9a-f]{64}$/i
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/**
 * The three shapes a seed node is made of, as predicates over `unknown`.
 *
 * Here rather than beside each caller because there are three of them - the environment parsing
 * below, the discovery that reads an oxend reply, and the fake's refusal - and a validator that
 * disagrees with its siblings accepts on one path what another rejects.
 */
export function isHex64(value: unknown): value is string {
  return typeof value === 'string' && HEX64.test(value)
}

/**
 * libsession dials a seed directly and resolves no host names, so a name here never becomes one.
 */
export function isIpv4(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = IPV4.exec(value)
  return match !== null && match.slice(1).every((octet) => Number(octet) <= 255)
}

export function isPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65535
}

/**
 * The trimmed value, or undefined for both unset and whitespace: a blank line in a .env is unset.
 */
function set(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed
}

function pubkey(value: string, variable: string): string {
  if (!isHex64(value.trim()))
    throw new Error(`${variable} must be 64 hex characters, not ${JSON.stringify(value)}`)
  return value.trim().toLowerCase()
}

/**
 * Splits `scheme://host:port/rest` with the scheme, the port and the path all optional.
 *
 * Hand-rolled because this package typechecks with no DOM and no node types, where `URL` does not
 * exist - and it is the one package the Electron main process, the renderer and Hermes all read.
 */
const ADDRESS = /^(?:([a-z][a-z0-9+.-]*):\/\/)?([^/:?#]+)(?::(\d+))?(?:[/?#].*)?$/i

interface Address {
  scheme: string | undefined
  host: string
  port: number | undefined
}

function address(value: string, variable: string): Address {
  const match = ADDRESS.exec(value)
  if (match === null) throw new Error(`${variable} is not an address: ${JSON.stringify(value)}`)

  const [, scheme, host, port] = match
  if (host === undefined || host.length === 0)
    throw new Error(`${variable} has no host: ${JSON.stringify(value)}`)
  if (scheme !== undefined && scheme.toLowerCase() !== 'http' && scheme.toLowerCase() !== 'https')
    throw new Error(`${variable} must be http or https, not ${scheme}`)

  const number = port === undefined ? undefined : Number(port)
  if (number !== undefined && (number < 1 || number > 65535))
    throw new Error(`${variable} names no port: ${port}`)

  return { scheme: scheme?.toLowerCase(), host, port: number }
}

/**
 * Canonicalises the seed node's oxend RPC address.
 *
 * A bare host, `host:port` and `http://host:port` are all accepted because all three are what gets
 * copied out of a node table. The port defaults rather than being required: a devnet built by the
 * standard compose puts oxend's RPC on 1280.
 */
function seedUrl(value: string, variable: string): string {
  const { scheme, host, port } = address(value, variable)
  return `${scheme ?? 'http'}://${host}:${port ?? DEFAULT_SEED_RPC_PORT}`
}

function fileServer(url: string, key: string, variable: string): FileServerConfig {
  const { scheme, host, port } = address(url, variable)
  if (port === undefined)
    throw new Error(`${variable} must name a port: a devnet's file server is not on 80`)

  return {
    scheme: scheme === 'https' ? 'https' : 'http',
    host,
    port,
    ed25519PubkeyHex: key,
  }
}

/**
 * Turns a devnet build's environment into what the bridge needs, or says which variable is wrong.
 *
 * Every refusal names the variable, because these are set once in a file nobody looks at again and
 * libsession's own errors name none of them: a bad seed pubkey throws out of `from_hex` and a host
 * name where an address belongs throws out of libquic, both far below anything that knows the
 * value came from `EXPO_PUBLIC_SESSION_DEVNET_SEED_URL`.
 *
 * Takes the values rather than the environment: Metro only inlines `process.env.EXPO_PUBLIC_X`
 * where the name is written out literally, so each app has to do its own reading.
 */
export function parseDevnetConfig(env: DevnetEnv, prefix: string): DevnetConfig {
  const seed = set(env.seedUrl)
  if (seed === undefined)
    throw new Error(
      `${prefix}NETID is devnet but ${prefix}DEVNET_SEED_URL is not set. It is the seed node's ` +
        `oxend RPC: a bare host, host:port, or http://host:port, port ${DEFAULT_SEED_RPC_PORT} ` +
        `by default.`,
    )

  const config: DevnetConfig = { seedUrl: seedUrl(seed, `${prefix}DEVNET_SEED_URL`) }

  // Both or neither, because half of it silently leaves the *mainnet* file server in place: only
  // testnet has one of its own, so a devnet uploads to production storage and says nothing.
  const fsUrl = set(env.fileServerUrl)
  const fsKey = set(env.fileServerEd25519Pubkey)
  if ((fsUrl === undefined) !== (fsKey === undefined))
    throw new Error(
      `${prefix}FILE_SERVER_URL and ${prefix}FILE_SERVER_ED25519_PUBKEY go together: with one ` +
        `missing, uploads would go to the mainnet file server instead of the devnet's.`,
    )
  if (fsUrl !== undefined && fsKey !== undefined)
    config.fileServer = fileServer(
      fsUrl,
      pubkey(fsKey, `${prefix}FILE_SERVER_ED25519_PUBKEY`),
      `${prefix}FILE_SERVER_URL`,
    )

  return config
}

/**
 * What to hand the transport, or nothing.
 *
 * A devnet with nothing configured attaches nothing at all, never mainnet: falling back would put
 * real traffic on a build whose owner believes it is a sandbox, and the overlay stamping `devnet`
 * over that would confirm the belief rather than contradict it.
 */
export function netidForTransport(
  name: NetId,
  devnet: DevnetConfig | undefined,
): NetId | undefined {
  return name === 'devnet' && devnet === undefined ? undefined : name
}
