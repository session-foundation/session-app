/**
 * The fake libsession.
 *
 * Importable only from tests, the contract suite and an app's dev entry - the boundary
 * rules enforce that, so a production bundle cannot reach it.
 */

export { createFakeTransport } from './fakeBridge'
export { FakeSessionClient } from './FakeSessionClient'
export { FakeAccount, FakeWorld, resetFakeIds } from './world'
export { PHOTO_THUMBHASHES, friendsWithAttachments } from './attachments'
export { FIXTURE_NAMES, crowd, friends, newcomer, solo, strangers } from './fixtures'
export { rowShowcase } from './rows'
export { showcase } from './showcase'
export { noDatabaseOpen, unopenable } from './unopenable'
export type { FakeSetup, FixtureName } from './fixtures'
export {
  createFakeMediaSource,
  fakeThumbhashPixels,
  PHOTO_COUNT,
  photoFileName,
  photoFileNames,
  photoNumber,
} from './media'
export { decodeThumbhash } from './thumbhash'
export { backlog } from './backlog'
export { driveFakeClock, FAKE_FIXTURES, pickFakeFixture, startDevFake } from './devSetup'
export type { DevFake, DevPhotos, FakeDevEnv, FakeFixture } from './devSetup'
