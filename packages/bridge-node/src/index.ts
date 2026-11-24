import { createRequire } from 'node:module'

import type {
  AttachmentMedia,
  AttachmentThumbhash,
  AttachmentRef,
  BridgeTransport,
  DecodePlan,
  DecodePlanner,
  Frame,
  MediaSource,
  Request,
} from '@session/client'
import type { SessionBridgeOptions } from '@session/bridge-types'

/**
 * The shared open options, minus the one the addon takes differently.
 *
 * N-API hands a Uint8Array straight to C++, so there is no reason to make the main process
 * hex-encode a key for a call inside its own process - that is the only field that differs from
 * what the Nitro bridge is given.
 */
export interface NodeBridgeOptions extends Omit<SessionBridgeOptions, 'rawKeyHex'> {
  /**
   * The 32-byte database key. libsession accepts one but neither derives nor stores it, which
   * is why the app has a secure-storage port at all: generate once at first boot, keep it in
   * the OS keyring, and never let it reach the renderer.
   */
  rawKey?: Uint8Array
  /**
   * Whether a database created now keeps SQLite's header in plaintext, as iOS's does. Desktop
   * leaves it off; an existing database opens as it was made either way.
   */
  plaintextHeaderWhenNew?: boolean
  /** Overrides where the addon is loaded from. `SESSION_BRIDGE_ADDON` does the same. */
  addonPath?: string
}

interface NativeBridge {
  call(request: Request): void
  fetchMedia(messageId: number, index: number): Promise<AttachmentMedia>
  fetchThumbhash(messageId: number, index: number): Promise<AttachmentThumbhash>
  fetchThumbnail(messageId: number, index: number): Promise<Uint8Array>
  fetchRendition(messageId: number, index: number): Promise<AttachmentMedia>
  fetchStagedThumbnail(path: string): Promise<Uint8Array>
  close(): void
}

/** The transport, plus what does not go over it: the media, and how to draw it. */
export type NodeBridgeTransport = BridgeTransport & MediaSource & DecodePlanner

interface Addon {
  SessionBridge: new (
    options: Omit<NodeBridgeOptions, 'addonPath'>,
    onFrame: (frame: Frame) => void,
  ) => NativeBridge
  planDecode: (bytes: Uint8Array) => DecodePlan
}

const require = createRequire(import.meta.url)

function loadAddon(explicitPath: string | undefined): Addon {
  // Resolved rather than imported, so a bundler cannot try to follow it: the addon is a
  // platform binary that has to be found at runtime wherever the app was installed.
  const path =
    explicitPath ??
    process.env['SESSION_BRIDGE_ADDON'] ??
    require.resolve('@session/bridge-node/addon')
  return require(path) as Addon
}

/**
 * The bridge, backed by the real libsession.
 *
 * Runs in the Electron main process: Core owns its own threads, so nothing here blocks, and the
 * main process already owns the things the bridge needs - the key in safeStorage, the user data
 * directory, and the shutdown that has to close the database. The renderer never sees this, only
 * the frames it produces.
 */
export function createNodeBridgeTransport(options: NodeBridgeOptions): NodeBridgeTransport {
  const { addonPath, ...init } = options
  const { SessionBridge, planDecode } = loadAddon(addonPath)

  // Frames produced between construction and setSink would otherwise be dropped: libsession
  // publishes the initial state as the Client is built, which is before any caller can have
  // subscribed.
  let sink: ((frame: Frame) => void) | null = null
  const pending: Frame[] = []

  function deliver(frame: Frame): void {
    if (sink) sink(frame)
    else pending.push(frame)
  }

  const bridge = new SessionBridge(init, deliver)

  let closed = false

  return {
    send(request: Request): void {
      if (closed) return
      try {
        bridge.call(request)
      } catch (error) {
        // The addon could not read the request, so the shim never saw it. Answered the way any
        // other failed request is, on the stream, rather than thrown at whoever forwarded it.
        // The id is read defensively: `request` is renderer input and need not be an object.
        const message = error instanceof Error ? error.message : String(error)
        const id: unknown = (request as { id?: unknown } | null | undefined)?.id
        if (typeof id !== 'number') return
        deliver({ type: 'response', response: { id, error: message } })
      }
    },

    fetchMedia({ messageId, index }: AttachmentRef): Promise<AttachmentMedia> {
      if (closed) return Promise.reject(new Error('the bridge is closed'))
      return bridge.fetchMedia(messageId, index)
    },

    fetchThumbhash({ messageId, index }: AttachmentRef): Promise<AttachmentThumbhash> {
      if (closed) return Promise.reject(new Error('the bridge is closed'))
      return bridge.fetchThumbhash(messageId, index)
    },

    fetchThumbnail({ messageId, index }: AttachmentRef): Promise<Uint8Array> {
      if (closed) return Promise.reject(new Error('the bridge is closed'))
      return bridge.fetchThumbnail(messageId, index)
    },

    fetchRendition({ messageId, index }: AttachmentRef): Promise<AttachmentMedia> {
      if (closed) return Promise.reject(new Error('the bridge is closed'))
      return bridge.fetchRendition(messageId, index)
    },

    fetchStagedThumbnail(path: string): Promise<Uint8Array> {
      if (closed) return Promise.reject(new Error('the bridge is closed'))
      return bridge.fetchStagedThumbnail(path)
    },

    // A rule rather than a call into the bridge, so it answers after a close too.
    planDecode,

    setSink(onFrame: (frame: Frame) => void): void {
      sink = onFrame
      const buffered = pending.splice(0, pending.length)
      for (const frame of buffered) onFrame(frame)
    },

    close(): void {
      if (closed) return
      closed = true
      sink = null
      bridge.close()
    },
  }
}
