import { image, resetPhotos, set, type Kind } from './attachments'
import { ensureDm, FIXTURE_NAMES, type FakeSetup } from './fixtures'
import { FakeSessionClient } from './FakeSessionClient'
import { FakeWorld, resetFakeIds } from './world'

/** Messages each contact has sent, about half of them carrying attachments. */
const MESSAGES_PER_CONTACT = 30

/** What a contact sends, in turn: every album shape, clips, files, and the long sets. */
const PATTERN: readonly (readonly Kind[])[] = [
  image(1),
  image(3),
  ['video'],
  ['pdf'],
  image(5),
  ['image', 'video'],
  image(2),
  ['zip', 'pdf'],
  image(12),
  ['audio'],
  image(4),
  ['image', 'image', 'video', 'pdf'],
  image(32),
]

/**
 * A long history to use the app with: seven contacts, each with thirty messages, about half of
 * them carrying attachments, none of which has been downloaded.
 *
 * For a person trying the app rather than for a test, which is why it is large and none of it is
 * asserted on: `showcase` is one message per case, this is what an ordinary busy account looks
 * like - enough to scroll, to fetch in bulk, and to watch the cache fill.
 */
export function backlog(): FakeSetup {
  resetFakeIds()
  resetPhotos()
  const world = new FakeWorld()
  const [selfName, ...contactNames] = FIXTURE_NAMES
  const self = world.account(selfName)

  let turn = 0
  for (const name of contactNames) {
    const contact = world.account(name)
    ensureDm(self, contact, world)
    ensureDm(contact, self, world)
    for (let m = 0; m < MESSAGES_PER_CONTACT; m += 1) {
      const kinds = m % 2 === 0 ? PATTERN[turn++ % PATTERN.length] : undefined
      // A file the server has let go of, now and then, so the expired state is in the mix.
      const expired = kinds !== undefined && turn % 11 === 0
      const body = kinds === undefined ? `${name}, message ${String(m + 1)}` : `${name} sent these`
      self.deliverFrom(
        contact,
        body,
        world.now(),
        kinds === undefined ? [] : set([...kinds], { expired }),
      )
      world.advance(60_000)
    }
    world.settle()
  }

  return { world, clients: { [self.displayName]: new FakeSessionClient(self, world) } }
}
