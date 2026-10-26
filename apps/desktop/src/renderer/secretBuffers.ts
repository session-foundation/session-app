import type { Request } from '@session/bridge-types'

/**
 * The buffers in a request that carry a secret, which for now means a recovery phrase.
 *
 * Only fields the protocol marks as a secret are listed. Reading the command rather than scanning
 * the request for anything binary is what keeps that true: a buffer listed here is cleared once
 * it has been sent, and clearing one the sender still meant to read would empty it under them.
 *
 * Its own module, and typed as `ArrayBuffer[]` rather than anything from the DOM, so it carries no
 * DOM types: the desktop tests are checked as node and would otherwise drag the whole transport in
 * with them.
 */
export function secretBuffers(request: Request): ArrayBuffer[] {
  const command = request.command
  if (command.type !== 'restoreAccountFromWords' && command.type !== 'checkRecoveryPhrase') {
    return []
  }
  return [command.phrase.buffer as ArrayBuffer]
}

/**
 * Sends a request across the bridge port, then clears this side's copy of any secret in it.
 *
 * **Copied, not transferred.** Listing the phrase's buffer in `postMessage`'s transfer list would
 * move the bytes and leave nothing here to clear, but Electron's `MessagePortMain` drops a message
 * that arrives with a transferred `ArrayBuffer`, silently: no error on either side, and a
 * recovery phrase that never got an answer. So the request is structured-cloned as usual, and this
 * side's bytes are zeroed straight after -- the clone is taken inside `postMessage`, so the copy on
 * its way to main is untouched. Main's copy is the shim's to zero when it is done.
 */
export function sendClearingSecrets(
  port: { postMessage: (message: unknown) => void },
  request: Request,
): void {
  port.postMessage(request)
  for (const buffer of secretBuffers(request)) new Uint8Array(buffer).fill(0)
}
