import type { BridgeTransport, Command, Frame, Response } from '@session/client'

/**
 * The bridge's one sink, shared between main's own requests and a window's channel.
 *
 * Installed as the bridge's first sink, so it takes over the bridge's buffering: frames that arrive
 * before a window attaches are held for it, as the bridge holds them until its first sink.
 */
export interface FrameRouter {
  /** A request of main's own. Its answer, however late, never reaches a window. */
  request(command: Command): Promise<Response>
  /** Where every other frame goes, starting with those that arrived before any window attached. */
  attach(sink: (frame: Frame) => void): void
}

export function routeFrames(bridge: BridgeTransport): FrameRouter {
  // Negative, because a window's client numbers its requests up from 1 on the same bridge.
  let nextRequestId = -1
  const waiting = new Map<number, (response: Response) => void>()
  let sink: ((frame: Frame) => void) | null = null
  const held: Frame[] = []

  bridge.setSink((frame) => {
    if (frame.type === 'response') {
      const answer = waiting.get(frame.response.id)
      if (answer !== undefined) {
        waiting.delete(frame.response.id)
        answer(frame.response)
        return
      }
    }
    if (sink === null) held.push(frame)
    else sink(frame)
  })

  return {
    request(command) {
      const id = nextRequestId--
      return new Promise((resolve) => {
        waiting.set(id, resolve)
        bridge.send({ id, command })
      })
    },

    attach(onFrame) {
      for (const frame of held.splice(0, held.length)) onFrame(frame)
      sink = onFrame
    },
  }
}
