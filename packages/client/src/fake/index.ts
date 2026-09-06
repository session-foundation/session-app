/**
 * The fake libsession.
 *
 * Importable only from tests, the contract suite and an app's dev entry - the boundary
 * rules enforce that, so a production bundle cannot reach it.
 */

export { createFakeTransport } from './fakeBridge'
export { FakeSessionClient } from './FakeSessionClient'
export { FakeAccount, FakeWorld, resetFakeIds } from './world'
export { FIXTURE_NAMES, crowd, friends, solo, strangers } from './fixtures'
export type { FakeSetup, FixtureName } from './fixtures'
