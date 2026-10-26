import type { Request } from '@session/bridge-types'
import { describe, expect, it } from 'vitest'

import { secretBuffers, sendClearingSecrets } from '#src/renderer/secretBuffers'

const words = 'one two three'
const encode = (text: string): Uint8Array => new TextEncoder().encode(text)

/**
 * A port that copies what it is given the way a real one does, and records whether anything was
 * offered for transfer -- which Electron's main-process port answers by dropping the message.
 */
function recordingPort() {
  const sent: unknown[] = []
  let transferred = false
  return {
    sent,
    transferred: () => transferred,
    postMessage: (message: unknown, ...rest: unknown[]) => {
      if (rest.length > 0) transferred = true
      sent.push(structuredClone(message))
    },
  }
}

describe('which buffers carry a secret', () => {
  it('lists the phrase a restore carries', () => {
    const phrase = encode(words)
    const request: Request = { id: 1, command: { type: 'restoreAccountFromWords', phrase } }
    expect(secretBuffers(request)).toEqual([phrase.buffer])
  })

  it('lists the phrase a check carries too, which is the same secret', () => {
    const phrase = encode(words)
    const request: Request = { id: 2, command: { type: 'checkRecoveryPhrase', phrase } }
    expect(secretBuffers(request)).toEqual([phrase.buffer])
  })

  it('lists nothing for a command carrying no secret', () => {
    const request: Request = { id: 3, command: { type: 'getAccountInfo' } }
    expect(secretBuffers(request)).toEqual([])
  })
})

/**
 * Sending a phrase, which has two ways to be wrong and neither says anything at the time: a
 * transfer list makes Electron drop the message, so the restore never answers; and not clearing
 * leaves the phrase readable in this process after it has gone.
 */
describe('sending a request', () => {
  it('sends the phrase intact, transfers nothing, and zeroes this side afterwards', () => {
    const phrase = encode(words)
    const port = recordingPort()
    sendClearingSecrets(port, { id: 4, command: { type: 'restoreAccountFromWords', phrase } })

    expect(port.transferred()).toBe(false)
    const sent = port.sent[0] as { command: { phrase: Uint8Array } }
    expect(new TextDecoder().decode(sent.command.phrase)).toBe(words)
    expect(phrase.every((byte) => byte === 0)).toBe(true)
  })

  it('leaves a request with no secret alone', () => {
    const port = recordingPort()
    const request: Request = { id: 5, command: { type: 'getAccountInfo' } }
    sendClearingSecrets(port, request)
    expect(port.sent).toEqual([request])
  })
})
