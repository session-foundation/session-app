import { resetPhotos, set } from './attachments'
import { FakeSessionClient } from './FakeSessionClient'
import { ensureDm, type FakeSetup } from './fixtures'
import { FakeWorld, resetFakeIds, type FakeAccount } from './world'

/**
 * What the `replies` fixture says, for whatever drives it: each line is unique in the conversation.
 *
 * Oldest first, the chain reads `meet` <- `station` <- `seeYou`, with more than a page of history
 * between each pair, so following either quote reads a window in.
 */
export const REPLIES = {
  /** The oldest message, and the end of the chain. */
  meet: 'Where shall we meet on Saturday?',
  /** Ours, answering `meet` from far below it. */
  station: 'At the station, by the clock',
  /** Ours, just above the page the conversation opens on: `repliesNearEnd` only. */
  homeAsk: 'Text me when you get home',
  /** Bob's picture, and our answer to it. */
  view: 'The view from the top',
  whereIsThis: 'Where is this?',
  /** Bob's, answering `station` from far below it. */
  seeYou: 'See you there',
  /** Bob's, answering a message that never reached this device. */
  neverReceived: 'What did it say?',
  /** Bob's, answering a message of ours deleted since. */
  deletedSince: 'Too late, I read it',
  /** Bob's, next to the newest, answering `homeAsk`: off screen, within a screen of the end. */
  homeNow: 'Home now',
  /** The newest message. */
  newest: 'Good night',
} as const

/** How many plain messages sit between the chain's links: more than a jump's window reaches. */
const FILLER = 90

/** The two sides of the conversation, and the world they share. */
type Pair = { self: FakeAccount; peer: FakeAccount; world: FakeWorld }

/** The id each side knows a message of this conversation by, found by its unique body. */
function idsOf({ self, peer }: Pair, body: string): { own: number; theirs: number } {
  const own = self.messages(peer.sessionId).find((m) => m.body === body)
  const theirs = peer.messages(self.sessionId).find((m) => m.body === body)
  if (!own || !theirs) throw new Error(`"${body}" did not reach both sides`)
  return { own: own.id, theirs: theirs.id }
}

/** One message from either side, answering `replyTo` where given, delivered before the next. */
function say(pair: Pair, from: 'in' | 'out', body: string, replyTo?: string): void {
  const { self, peer, world } = pair
  const answered = replyTo === undefined ? undefined : idsOf(pair, replyTo)
  if (from === 'in') peer.send(self.sessionId, body, answered?.theirs)
  else self.send(peer.sessionId, body, answered?.own)
  world.settle()
}

function filler(pair: Pair, from: number): void {
  for (let n = from; n < from + FILLER; n += 1)
    say(pair, n % 2 === 0 ? 'in' : 'out', `Line ${String(n)} of the plan`)
}

/**
 * Alice and Bob with a long conversation full of replies: a chain to walk back through, a reply
 * to a picture, one to a message never received and one to a message deleted since. With
 * `nearEnd`, also `homeNow` and the `homeAsk` it answers: a separate world, as the two rows move
 * the page every other spec on this one reads by where its rows sit.
 */
export function replies({ nearEnd = false }: { nearEnd?: boolean | undefined } = {}): FakeSetup {
  resetFakeIds()
  resetPhotos()
  const world = new FakeWorld()
  const self = world.account('Alice')
  const peer = world.account('Bob')
  ensureDm(self, peer, world)
  ensureDm(peer, self, world)
  const pair = { self, peer, world }

  say(pair, 'in', REPLIES.meet)
  filler(pair, 1)
  say(pair, 'out', REPLIES.station, REPLIES.meet)
  filler(pair, 1 + FILLER)
  if (nearEnd) say(pair, 'out', REPLIES.homeAsk)

  self.deliverFrom(peer, REPLIES.view, world.now(), set(['image'], { hashed: true }))
  world.advance()
  const view = self.messages(peer.sessionId).find((m) => m.body === REPLIES.view)
  self.send(peer.sessionId, REPLIES.whereIsThis, view?.id)
  world.settle()

  say(pair, 'in', REPLIES.seeYou, REPLIES.station)

  // Named as the wire names a message, by an author and a time nothing here was sent at.
  self.deliverFrom(peer, REPLIES.neverReceived, world.now(), [], {
    author: self.sessionId,
    timestamp: 1,
  })
  world.advance()

  const regretted = 'Ignore that, wrong chat'
  say(pair, 'out', regretted)
  say(pair, 'in', REPLIES.deletedSince, regretted)
  self.deleteMessage(idsOf(pair, regretted).own, 'here')

  if (nearEnd) say(pair, 'in', REPLIES.homeNow, REPLIES.homeAsk)
  say(pair, 'in', REPLIES.newest)
  return { world, clients: { [self.displayName]: new FakeSessionClient(self, world) } }
}
