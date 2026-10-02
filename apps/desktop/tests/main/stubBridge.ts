import type { BridgeTransport, Frame, Request, Response } from '@session/client'

/** A frame a window is owed: an answer to one of its own requests. */
export const owed = (id: number): Frame => ({
  type: 'response',
  response: { id, result: { type: 'empty' } },
})

export interface StubBridge extends BridgeTransport {
  sent: Request[]
  emit(frame: Frame): void
  /** Answers the request with `id`, now. */
  answer(id: number, response: Omit<Response, 'id'>): void
}

/**
 * A bridge that buffers frames until its first sink, as the real one does. `respond` answers a
 * request a tick later; without it nothing is answered until `answer` is called.
 */
export function stubBridge(
  options: { early?: Frame[]; respond?: (request: Request) => Omit<Response, 'id'> } = {},
): StubBridge {
  let sink: ((frame: Frame) => void) | null = null
  const pending = [...(options.early ?? [])]
  const sent: Request[] = []
  const emit = (frame: Frame): void => {
    if (sink) sink(frame)
    else pending.push(frame)
  }
  const answer = (id: number, response: Omit<Response, 'id'>): void => {
    emit({ type: 'response', response: { id, ...response } })
  }
  return {
    sent,
    emit,
    answer,
    send(request) {
      sent.push(request)
      const { respond } = options
      if (respond !== undefined)
        queueMicrotask(() => {
          answer(request.id, respond(request))
        })
    },
    setSink(onFrame) {
      sink = onFrame
      for (const frame of pending.splice(0, pending.length)) onFrame(frame)
    },
    close() {},
  }
}
