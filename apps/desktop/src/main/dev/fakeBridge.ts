import type { BridgeTransport } from '@session/client'
import { createFakeTransport, crowd, friends } from '@session/client/fake'

/**
 * The bridge, backed by the fake.
 *
 * This is a dev entry and lives here so the boundary rules can say so: production code
 * never imports the fake, and the dynamic import in ../bridge.ts is what keeps it out of a
 * shipped bundle.
 */
export function createFakeBridge(): BridgeTransport {
  // A conversation list big enough to measure, when something asks for one. The default stays the
  // two-account fixture, so nothing about the ordinary dev loop changes.
  const peers = Number(process.env['SESSION_FAKE_CONVERSATIONS'] ?? '0')
  const { world, clients } =
    peers > 0
      ? crowd({ peers, history: Number(process.env['SESSION_FAKE_HISTORY'] ?? '1') })
      : friends(['Alice', 'Bob'], { history: 4 })
  const alice = clients['Alice']
  if (!alice) throw new Error('the fixture did not produce a client')

  // The fake's clock is manual so tests can decide when a send lands. Running the app there
  // is nobody to advance it, so let it tick.
  const ticking = setInterval(() => {
    world.settle()
  }, 50)
  ticking.unref?.()

  return createFakeTransport(alice)
}
