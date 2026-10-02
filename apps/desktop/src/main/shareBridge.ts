import type { BridgeTransport, Frame } from '@session/client'

export interface SharedBridge {
  /** Main's own. Its answers never reach the renderer, and closing it closes nothing. */
  main: BridgeTransport
  /** The renderer's: every other frame, held until its sink attaches. */
  renderer: BridgeTransport
}

/**
 * Two transports over one bridge, so main can hold a client of its own beside the renderer's.
 *
 * Installed as the bridge's first sink, so the bridge's own buffering becomes this one's: frames
 * from before a window attaches are held for it. Main's requests travel on negated ids, since both
 * clients number theirs up from 1, and a renderer request outside its own space is refused rather
 * than answered as main's.
 */
export function shareBridge(bridge: BridgeTransport): SharedBridge {
  let toMain: ((frame: Frame) => void) | null = null
  let toRenderer: ((frame: Frame) => void) | null = null
  const held: Frame[] = []

  bridge.setSink((frame) => {
    if (frame.type === 'response' && frame.response.id < 0) {
      toMain?.({ type: 'response', response: { ...frame.response, id: -frame.response.id } })
    } else if (toRenderer === null) {
      held.push(frame)
    } else {
      toRenderer(frame)
    }
  })

  return {
    main: {
      send(request) {
        bridge.send({ ...request, id: -request.id })
      },
      setSink(onFrame) {
        toMain = onFrame
      },
      // The bridge is the app's, closed on quit; a client of main's going away takes nothing with it.
      close() {
        toMain = null
      },
    },
    renderer: {
      send(request) {
        if (Number.isInteger(request.id) && request.id > 0) {
          bridge.send(request)
          return
        }
        // Renderer input: without a numeric id there is nobody to answer.
        if (typeof request.id === 'number')
          toRenderer?.({
            type: 'response',
            response: { id: request.id, error: 'a request id is a positive integer' },
          })
      },
      setSink(onFrame) {
        toRenderer = onFrame
        for (const frame of held.splice(0, held.length)) onFrame(frame)
      },
      close() {
        toRenderer = null
      },
    },
  }
}
