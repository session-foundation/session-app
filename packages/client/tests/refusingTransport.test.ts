import { describe, expect, it } from 'vitest'

import { BRIDGE_UNAVAILABLE, createRefusingTransport } from '#src/refusingTransport'
import { createSessionClient } from '#src/createSessionClient'

/** What a bridge that could not be made answers with, through the client every screen uses. */
describe('a refusing transport', () => {
  it('answers every request with why the bridge could not start', async () => {
    const client = createSessionClient(createRefusingTransport('no native module'))
    await expect(client.getAccountInfo()).rejects.toThrow(
      /the bridge could not start: no native module/,
    )
    await expect(client.discardAccount()).rejects.toThrow(/the bridge could not start/)
  })

  it('does not prefix the refusal with the command that met it', async () => {
    const client = createSessionClient(createRefusingTransport('no native module'))
    await expect(client.getAccountInfo()).rejects.toThrow(
      /^the bridge could not start: no native module$/,
    )
  })

  it('marks each refusal as one with no bridge behind it', async () => {
    const client = createSessionClient(createRefusingTransport('no native module'))
    await expect(client.getAccountInfo()).rejects.toMatchObject({ code: BRIDGE_UNAVAILABLE })
  })
})
