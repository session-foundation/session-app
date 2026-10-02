import type { BridgeTransport, Frame, Request, Response } from '@session/client'

/** A frame the renderer is owed: an answer to one of its own requests. */
export const owed = (id: number): Frame => ({
  type: 'response',
  response: { id, result: { type: 'empty' } },
})

export interface StubBridge extends BridgeTransport {
  sent: Request[]
  closed: boolean
  emit(frame: Frame): void
  /** Answers the request with `id`, now. */
  answer(id: number, response: Omit<Response, 'id'>): void
}

/** A bridge that buffers frames until its first sink, as the real one does. */
export function stubBridge(options: { early?: Frame[] } = {}): StubBridge {
  let sink: ((frame: Frame) => void) | null = null
  const pending = [...(options.early ?? [])]
  const sent: Request[] = []
  const emit = (frame: Frame): void => {
    if (sink) sink(frame)
    else pending.push(frame)
  }
  const stub: StubBridge = {
    sent,
    closed: false,
    emit,
    answer(id, response) {
      emit({ type: 'response', response: { id, ...response } })
    },
    send(request) {
      sent.push(request)
    },
    setSink(onFrame) {
      sink = onFrame
      for (const frame of pending.splice(0, pending.length)) onFrame(frame)
    },
    close() {
      stub.closed = true
    },
  }
  return stub
}
