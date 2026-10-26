import type { Attachment } from '@session/bridge-types'

import { image, resetPhotos, set } from './attachments'
import { ensureDm, type FakeSetup, type FixtureName } from './fixtures'
import { FakeSessionClient } from './FakeSessionClient'
import { FakeWorld, resetFakeIds } from './world'

/**
 * Every shape a message's attachments can take, in one conversation.
 *
 * For looking at rather than for asserting on: the e2e suite runs against `friends`, whose three
 * messages are chosen to be the fewest that reach each code path. This is the opposite - one
 * message per case, so a pass over the transcript is a pass over the design.
 *
 * The order is the album's counts first, then the mixes that force a list, then the states a
 * message can be in that have nothing to do with what is attached.
 */
export function showcase(names: readonly [FixtureName, FixtureName] = ['Alice', 'Bob']): FakeSetup {
  resetFakeIds()
  resetPhotos()
  const world = new FakeWorld()
  const [firstName, secondName] = names
  const first = world.account(firstName)
  const second = world.account(secondName)

  ensureDm(first, second, world)
  ensureDm(second, first, world)

  const messages: Array<[string, Attachment[]]> = [
    // The album, at every count its layout has a shape for, and one past the cap.
    ['One picture', set(image(1))],
    ['Two, as halves', set(image(2))],
    ['Three: one big, two stacked', set(image(3))],
    ['Four, an even grid', set(image(4))],
    ['Five: one big beside a quad', set(image(5))],
    ['Twelve, so seven are behind the count', set(image(12))],
    ['Thirty-two', set(image(32))],

    // The same shapes from a sender that supplied no ThumbHash, so nothing draws before the bytes.
    ['Three with no hash to draw', set(image(3), { hashed: false })],
    ['Five with no hash to draw', set(image(5), { hashed: false })],

    // A video is a file row until libsession has a still for it, so each of these is a list.
    ['A clip on its own', set(['video'])],
    ['Pictures and a clip', set(['image', 'image', 'video'])],
    ['Clips only', set(['video', 'video'])],

    // One plain file puts the whole set in a list, pictures included.
    ['A clip and its notes', set(['video', 'pdf'])],
    ['Pictures, a clip and the paperwork', set(['image', 'image', 'video', 'pdf'])],
    ['Paperwork only', set(['pdf', 'zip', 'sheet'])],
    ['One file', set(['pdf'])],
    ['A recording', set(['audio'])],

    // Longer than the transcript holds, so the list caps and the rest moves into a sheet.
    ['The whole roll', set([...image(13), 'pdf'])],

    // Nothing to do with the count: a file the server will not hand out again.
    ['One of these is gone', set(['pdf'], { expired: true })],
    [
      'Four of these five are gone',
      set(['pdf', 'zip', 'sheet', 'audio', 'pdf'], { expired: (index) => index < 4 }),
    ],
  ]

  for (const [body, attachments] of messages) {
    // Nothing is fetched: the conversation has not been asked what to download.
    first.deliverFrom(second, body, world.now(), attachments)
    world.settle()
  }

  return {
    world,
    clients: {
      [firstName]: new FakeSessionClient(first, world),
      [secondName]: new FakeSessionClient(second, world),
    },
  }
}
