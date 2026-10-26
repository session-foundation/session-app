import type { BridgeTransport, Request } from '@session/client'
import { describe, expect, it, vi } from 'vitest'

import { mobileClient } from '#src/client'

const asked: unknown[] = []

// The real check reads staging state that only expo can create.
vi.mock('#src/files', () => ({
  mayExportTo: (destination: unknown) => {
    asked.push(destination)
    return false
  },
}))

function recording(): BridgeTransport & { sent: Request[] } {
  const sent: Request[] = []
  return {
    sent,
    send: (request) => {
      sent.push(request)
    },
    setSink: () => undefined,
    close: () => undefined,
  }
}

describe('the mobile client', () => {
  it('holds an export to the files port, and never sends a refused one to the bridge', async () => {
    const transport = recording()
    const client = mobileClient(transport)
    const database = '/data/user/0/org.getsession.session2/files/session/mainnet/session.db'

    await expect(client.exportAttachment(7, 0, database)).rejects.toThrow('was not staged')

    expect(asked).toEqual([database])
    expect(transport.sent).toEqual([])
  })
})
