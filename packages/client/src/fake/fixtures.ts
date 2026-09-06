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
      autoDownload: 'none',
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

export interface FakeSetup {
  world: FakeWorld
  clients: Record<string, SessionClient>
}

/**
 * Two accounts that already know each other, with a little history.
 *
 * This is the shape the seeded states in the e2e suite take, so a flow written against the
 * fake reads the same as the one written against a real seeded swarm.
 */
export function friends(
  names: readonly [FixtureName, FixtureName] = ['Alice', 'Bob'],
  options: { history?: number } = {},
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
