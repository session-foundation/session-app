import { readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import type { Command, Frame, Response } from '@session/bridge-types'
import { createSessionClient, type BridgeTransport, type SessionClient } from '@session/client'

import { createNodeBridgeTransport, type NodeBridgeTransport } from '#src/index'

/**
 * Whether the addon that exists was built with the test commands in it.
 *
 * Read from the CMake cache beside it rather than by asking the addon, because a build without
 * them answers "the bridge does not implement this command yet" - which is indistinguishable
 * from a real regression, and would be reported as one.
 */
export function builtForTesting(): boolean {
  try {
    const cache = readFileSync(join(import.meta.dirname, '../build/CMakeCache.txt'), 'utf8')
    return /^SESSION_BRIDGE_TESTING:BOOL=ON$/m.test(cache)
  } catch {
    return false
  }
}

/**
 * Splits one frame stream in two: the facade's, and the harness's own.
 *
 * The test-only commands must not go through SessionClient - they are not things the app can
 * do, and putting them on that interface would be the first crack in it. So they ride the same
 * transport on request ids the facade will not reach, and their responses are taken off the
 * stream before the facade ever sees them.
 */
function tap(transport: BridgeTransport): {
  forFacade: BridgeTransport
  ask: (command: Command) => Promise<Response>
} {
  let facadeSink: ((frame: Frame) => void) | null = null
  const buffered: Frame[] = []
  const waiting = new Map<number, (response: Response) => void>()
  let nextId = 1_000_000

  transport.setSink((frame) => {
    if (frame.type === 'response') {
      const resolve = waiting.get(frame.response.id)
      if (resolve) {
        waiting.delete(frame.response.id)
        resolve(frame.response)
        return
      }
    }
    if (facadeSink) facadeSink(frame)
    else buffered.push(frame)
  })

  return {
    forFacade: {
      send: (request) => {
        transport.send(request)
      },
      setSink: (onFrame) => {
        facadeSink = onFrame
        for (const frame of buffered.splice(0, buffered.length)) onFrame(frame)
      },
      close: () => {
        transport.close()
      },
    },
    ask: (command) =>
      new Promise<Response>((resolve) => {
        const id = nextId++
        waiting.set(id, resolve)
        transport.send({ id, command })
      }),
  }
}

export interface Peer {
  client: SessionClient
  /** The media source, which answers beside the stream rather than on it. */
  transport: NodeBridgeTransport
  ask: (command: Command) => Promise<Response>
  sessionId: string
  seed: string
  dir: string
  /** How this peer was opened, so a restart opens it the same way. */
  deferred: boolean
}

export async function openPeer(dir: string, { deferred = false } = {}): Promise<Peer> {
  await mkdir(join(dir, 'cache'), { recursive: true })
  const transport = createNodeBridgeTransport({
    dbPath: join(dir, 'session.db'),
    cacheDir: join(dir, 'cache'),
    rawKey: new Uint8Array(32).fill(11),
    // Eagerly, because a peer is only useful once it has an identity to send from -- except a
    // newcomer, which exists precisely to have none.
    deferAccount: deferred,
  })
  const { forFacade, ask } = tap(transport)
  const client = createSessionClient(forFacade)

  const info = await client.getAccountInfo()
  if (deferred)
    // No account, so no seed to ask for: the test-only command answers off one.
    return { client, transport, ask, sessionId: '', seed: '', dir, deferred }

  const seed = await ask({ type: 'getTestAccountSeed' })
  if (seed.result?.type !== 'hex') throw new Error(seed.error ?? 'no seed: build with testing on')

  return {
    client,
    transport,
    ask,
    sessionId: info.sessionId ?? '',
    seed: seed.result.hex,
    dir,
    deferred,
  }
}
