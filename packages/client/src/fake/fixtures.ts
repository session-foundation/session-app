import type { Attachment } from '@session/bridge-types'

import type { SessionClient } from '../types'

import { FakeSessionClient } from './FakeSessionClient'
import { FakeWorld, resetFakeIds, type FakeAccount } from './world'

/**
 * Gives `self` a conversation with `peer` without announcing it.
 *
 * A fixture is meant to look like state that was already there when the app started, so it
 * seeds quietly; the events a test cares about are the ones it causes itself.
 */
function ensureDm(self: FakeAccount, peer: FakeAccount, world: FakeWorld, request = false): void {
  if (self.get(peer.sessionId)) return
  self.upsertConversation(
    {
      id: peer.sessionId,
      kind: 'dm',
      displayName: peer.displayName,
      lastActivity: world.now(),
      priority: 0,
      unreadCount: 0,
      markedUnread: false,
      request,
      awaitingApproval: false,
      noteToSelf: false,
      blocked: false,
    },
    { announce: false },
  )
}

/**
 * Names are deliberately not substrings of one another: a test that looks up a row by the
 * text on screen must not match two of them. (Alice/Alicia would; Alice/Bob will not.)
 */
export const FIXTURE_NAMES = [
  'Alice',
  'Bob',
  'Charlie',
  'Dracula',
  'Emily',
  'Frank',
  'Grace',
  'Hugo',
] as const

export type FixtureName = (typeof FIXTURE_NAMES)[number]

/**
 * Pictures only, so the message is gallery-viewable and draws as pictures.
 *
 * Dimensions are the sender's and are what the placeholder is laid out from, so they are set:
 * without them a transcript jumps as each one lands.
 *
 * The blurhashes are real and their averages are chosen; their gradients are filler, which the
 * decoder never reads. No 1.x client sends one at all, so this fixture is the only way to see the
 * coloured placeholder before something learns to encode them.
 */
const SEEDED_PICTURES: Attachment[] = [
  {
    index: 0,
    contentType: 'image/jpeg',
    filename: 'harbour.jpg',
    blurhash: 'LK9[P[fQfQfQfQfQfQfQfQfQfQfQ',
    size: 2_411_724,
    voiceMessage: false,
    width: 1600,
    height: 1200,
    uploaded: true,
    availability: 'absent',
    fetchDone: 0,
    fetchTotal: 0,
  },
  {
    index: 1,
    contentType: 'image/png',
    filename: 'ferry.png',
    blurhash: 'LKNv#efQfQfQfQfQfQfQfQfQfQfQ',
    size: 812_004,
    voiceMessage: false,
    width: 1200,
    height: 1600,
    uploaded: true,
    availability: 'absent',
    fetchDone: 0,
    fetchTotal: 0,
  },
]

/**
 * One picture and one file, which libsession's rule makes *not* gallery-viewable: a message is
 * only shown as pictures when every attachment is one. This is what draws the file form.
 */
const SEEDED_FILES: Attachment[] = [
  {
    index: 0,
    contentType: 'image/jpeg',
    filename: 'receipt.jpg',
    blurhash: 'LKF=mzfQfQfQfQfQfQfQfQfQfQfQ',
    size: 96_500,
    voiceMessage: false,
    width: 900,
    height: 1200,
    uploaded: true,
    availability: 'absent',
    fetchDone: 0,
    fetchTotal: 0,
  },
  {
    index: 1,
    contentType: 'application/pdf',
    filename: 'itinerary.pdf',
    size: 184_320,
    voiceMessage: false,
    uploaded: true,
    availability: 'absent',
    fetchDone: 0,
    fetchTotal: 0,
  },
]

/**
 * More attachments than a message draws in the transcript.
 *
 * Thirteen, so the eighth row is followed by "Show All" and the sheet has five to add. A mixed
 * set, because the rule that sends a message to the list is one plain file - and the case worth
 * having a fixture for is the one no composer can produce.
 */
const SEEDED_MANY: Attachment[] = Array.from({ length: 13 }, (_, at) => ({
  index: at,
  ...(at === 12
    ? { contentType: 'application/pdf', filename: 'contact-sheet.pdf' }
    : {
        contentType: 'image/jpeg',
        filename: `roll-${String(at + 1).padStart(2, '0')}.jpg`,
        blurhash: 'LKAnV+fQfQfQfQfQfQfQfQfQfQfQ',
        width: 1200,
        height: 900,
      }),
  size: 120_000 + at * 4_000,
  voiceMessage: false,
  uploaded: true,
  availability: 'absent',
  fetchDone: 0,
  fetchTotal: 0,
}))

export interface FakeSetup {
  world: FakeWorld
  clients: Record<string, SessionClient>
}

/**
 * One client with no identity yet: the state the app is in on first launch.
 *
 * The only fixture that reaches the onboarding screens. The app chooses between onboarding and
 * everything else on `haveAccount`, so a world where every account already has one leaves that
 * whole branch unreachable -- which is why this exists separately rather than as an option on
 * `solo`: there are no peers, no conversations and no history to seed, because there is nobody to
 * seed them for yet.
 */
export function newcomer(name: FixtureName = 'Alice'): FakeSetup {
  resetFakeIds()
  const world = new FakeWorld()
  const self = world.account(name, { haveAccount: false })
  return { world, clients: { [self.displayName]: new FakeSessionClient(self, world) } }
}

/**
 * Two accounts that already know each other, with a little history.
 *
 * This is the shape the seeded states in the e2e suite take, so a flow written against the
 * fake reads the same as the one written against a real seeded swarm.
 */
export function friends(
  names: readonly [FixtureName, FixtureName] = ['Alice', 'Bob'],
  options: { history?: number; attachments?: boolean } = {},
): FakeSetup {
  resetFakeIds()
  const world = new FakeWorld()
  const [firstName, secondName] = names
  const first = world.account(firstName)
  const second = world.account(secondName)

  ensureDm(first, second, world)
  ensureDm(second, first, world)

  const history = options.history ?? 0
  for (let i = 0; i < history; i += 1) {
    const sender = i % 2 === 0 ? first : second
    const recipient = sender === first ? second : first
    sender.send(recipient.sessionId, `Message ${i + 1}`)
    world.settle()
  }

  // Delivered rather than sent: sending an attachment is not in the protocol, so the only way one
  // exists is arriving. Nothing is fetched for either - the conversation has not been asked yet.
  // Three messages: an album, a mixed set the list draws, and one longer than the transcript
  // will hold. Each shape is chosen from the set rather than set by a flag, so a fixture missing
  // one leaves that shape undrawn.
  if (options.attachments ?? true) {
    first.deliverFrom(second, 'Here are the photos', world.now(), SEEDED_PICTURES)
    world.settle()
    first.deliverFrom(second, 'And the paperwork', world.now(), SEEDED_FILES)
    world.settle()
    first.deliverFrom(second, 'The whole roll', world.now(), SEEDED_MANY)
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

/** One account with a populated, already-approved conversation list. */
export function solo(name: FixtureName = 'Alice', peers = 3): FakeSetup {
  resetFakeIds()
  const world = new FakeWorld()
  const self = world.account(name)
  const start = FIXTURE_NAMES.indexOf(name)

  for (let i = 0; i < peers; i += 1) {
    const peerName = FIXTURE_NAMES[(start + 1 + i) % FIXTURE_NAMES.length] ?? 'Bob'
    const peer = world.account(peerName)
    ensureDm(peer, self, world)
    ensureDm(self, peer, world)
    peer.send(self.sessionId, `Hello from ${peer.displayName}`)
    world.settle()
  }

  return { world, clients: { [name]: new FakeSessionClient(self, world) } }
}

/** Someone has written to us and has not been approved yet: the row sits in requests. */
export function strangers(
  names: readonly [FixtureName, FixtureName] = ['Alice', 'Bob'],
): FakeSetup {
  resetFakeIds()
  const world = new FakeWorld()
  const [firstName, secondName] = names
  const first = world.account(firstName)
  const second = world.account(secondName)

  // The sender knows who they wrote to; the recipient learns of them on delivery, which is
  // what puts the row in the request list.
  ensureDm(second, first, world)
  second.send(first.sessionId, 'Hi, can we talk?')
  world.settle()

  return {
    world,
    clients: {
      [firstName]: new FakeSessionClient(first, world),
      [secondName]: new FakeSessionClient(second, world),
    },
  }
}

/**
 * One account with an arbitrarily large, already-approved conversation list.
 *
 * `solo` cycles the eight named fixtures and so tops out at eight peers, which is the right size
 * for a flow test and useless for a measurement: the costs worth knowing - the projection re-sorting
 * the list, React mounting every row - only appear at a scale no hand-written fixture reaches.
 * Names here are generated rather than drawn from FIXTURE_NAMES for the same reason.
 */
export function crowd(options: { peers: number; history?: number; name?: FixtureName }): FakeSetup {
  resetFakeIds()
  const world = new FakeWorld()
  const self = world.account(options.name ?? 'Alice')
  const history = options.history ?? 1

  for (let i = 0; i < options.peers; i += 1) {
    const peer = world.account(`Peer ${String(i).padStart(4, '0')}`)
    ensureDm(peer, self, world)
    ensureDm(self, peer, world)
    for (let m = 0; m < history; m += 1) {
      peer.send(self.sessionId, `Message ${String(m + 1)} from ${peer.displayName}`)
    }
  }
  // Settled once at the end rather than per message: settling is O(the whole world), so doing it
  // inside the loop makes seeding quadratic and a thousand peers never finish.
  world.settle()

  return { world, clients: { [self.displayName]: new FakeSessionClient(self, world) } }
}
