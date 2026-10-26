import { SERVABLE_VECTORS } from '@session/client-contract'
import { describe, expect, it } from 'vitest'

import { servableContentType } from '#src/main/media'

/** The shim's `servable_content_type` answers the same vectors in bridge-node's tests. */
describe('what the media scheme will serve', () => {
  it('serves and refuses what every servable check does', () => {
    for (const { declared, bytes, served } of SERVABLE_VECTORS) {
      expect(servableContentType(declared, bytes), `${declared} ${String(bytes.length)}`).toBe(
        served,
      )
    }
  })
})
