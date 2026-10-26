import type { BridgeTransport, Frame } from '@session/client'

/**
 * The transport, refusing an `exportAttachment` whose destination the files port did not hand out.
 *
 * `save_attachment` writes wherever the request says with no containment check of its own, so
 * this is the one place every such request passes before the native write. Answered on the stream
 * as any failed request is, so the caller's promise rejects rather than hangs.
 */
export function refuseUnstagedExports(
  transport: BridgeTransport,
  mayExportTo: (destination: unknown) => boolean,
): BridgeTransport {
  let sink: ((frame: Frame) => void) | null = null
  return {
    send(request) {
      if (
        request.command.type === 'exportAttachment' &&
        !mayExportTo(request.command.destination)
      ) {
        sink?.({
          type: 'response',
          response: { id: request.id, error: 'exportAttachment.destination was not staged' },
        })
        return
      }
      transport.send(request)
    },
    setSink(onFrame) {
      sink = onFrame
      transport.setSink(onFrame)
    },
    close() {
      sink = null
      transport.close()
    },
  }
}
