import type { BridgeTransport, Frame, Request } from '@session/client'

import { sendClearingSecrets } from './secretBuffers'

/**
 * The renderer's whole view of libsession: frames in, requests out, in order, over the one
 * MessagePort the preload hands into this world.
 *
 * The port arrives a moment after the page starts, so both directions are buffered until it does.
 * Dropping a request sent in that window would strand the app on its loading screen - the first
 * thing it asks for is the account, and nothing else happens until that comes back.
 */
export function createPortTransport(): BridgeTransport {
  let port: MessagePort | null = null
  let onFrame: ((frame: Frame) => void) | null = null
  const queuedRequests: Request[] = []
  const queuedFrames: Frame[] = []

  function deliver(frame: Frame): void {
    if (onFrame) onFrame(frame)
    else queuedFrames.push(frame)
  }

  function receivePort(event: MessageEvent<unknown>): void {
    if (event.source !== window || event.data !== 'session-bridge-port') return
    const received = event.ports[0]
    if (!received) return

    port = received
    port.onmessage = (message: MessageEvent<Frame>) => {
      deliver(message.data)
    }
    port.start()

    for (const request of queuedRequests.splice(0, queuedRequests.length)) {
      sendClearingSecrets(port, request)
    }
  }

  window.addEventListener('message', receivePort)

  return {
    send(request: Request): void {
      if (port) sendClearingSecrets(port, request)
      else queuedRequests.push(request)
    },

    setSink(handler: (frame: Frame) => void): void {
      onFrame = handler
      for (const frame of queuedFrames.splice(0, queuedFrames.length)) handler(frame)
    },

    close(): void {
      // The listener goes too. A port that arrives after this would otherwise be adopted by a
      // closed transport and flush requests nobody is waiting for any more.
      window.removeEventListener('message', receivePort)
      port?.close()
      port = null
      onFrame = null
      queuedRequests.length = 0
      queuedFrames.length = 0
    },
  }
}
