import { friendsWithAttachments } from './attachments'
import { backlog } from './backlog'
import type { FakeSessionClient } from './FakeSessionClient'
import { crowd, newcomer, type FakeSetup } from './fixtures'
import { photoFileNames, thumbnailFileNames } from './media'
import { rowShowcase } from './rows'
import { showcase } from './showcase'
import type { SessionClient } from '../types'
import { unopenable } from './unopenable'
import type { FakeWorld } from './world'

/**
 * How an app's dev fake starts, from the environment: which world, how fast its clock runs, and
 * whether its database opens.
 *
 * Shared so desktop and mobile start the same worlds from the same variables.
 */

export const FAKE_FIXTURES = [
  'friends',
  'showcase',
  'backlog',
  'newcomer',
  'crowd',
  'rows',
] as const

export type FakeFixture = (typeof FAKE_FIXTURES)[number]

/**
 * The variables that start a dev fake, unset as undefined. One name on every platform: desktop
 * hands `process.env` over whole, mobile a record of literal reads, since Expo inlines a variable
 * only where its name is written out.
 */
export interface FakeDevEnv {
  /** One of `FAKE_FIXTURES`. Wins over the two below. */
  EXPO_PUBLIC_SESSION_FAKE_FIXTURE?: string | undefined
  /** `1` opens `newcomer`. Older than the fixture. */
  EXPO_PUBLIC_SESSION_NO_ACCOUNT?: string | undefined
  /** `1` opens `rows`, a conversation per state a row draws. Older than the fixture. */
  EXPO_PUBLIC_SESSION_FAKE_ROWS?: string | undefined
  /** How many peers `crowd` makes, and `crowd` when set. */
  EXPO_PUBLIC_SESSION_FAKE_CROWD_PEERS?: string | undefined
  /** Messages per peer in `crowd`. */
  EXPO_PUBLIC_SESSION_FAKE_CROWD_HISTORY?: string | undefined
  /** N runs the fake's clock N times slower. See `driveFakeClock`. */
  EXPO_PUBLIC_SESSION_FAKE_SLOWDOWN?: string | undefined
  /** `1` serves a database that will not open, for the failure screen. */
  EXPO_PUBLIC_SESSION_FAKE_FAILED_START?: string | undefined
}

/**
 * Unset as undefined; anything that is not a count is loud, as a typo must not size a world
 * quietly.
 */
function positiveInt(name: string, raw: string | undefined): number | undefined {
  const text = raw?.trim()
  if (text === undefined || text === '') return undefined
  const value = Number(text)
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name}=${text} is not a positive whole number`)
  }
  return value
}

function chosenFixture(env: FakeDevEnv, crowdPeers: number | undefined): FakeFixture {
  const named = env.EXPO_PUBLIC_SESSION_FAKE_FIXTURE?.trim()
  if (named !== undefined && named !== '') {
    if ((FAKE_FIXTURES as readonly string[]).includes(named)) return named as FakeFixture
    // Loud rather than a fallback: a typo would otherwise open some other world and look fine.
    throw new Error(
      `EXPO_PUBLIC_SESSION_FAKE_FIXTURE=${named} is not a fixture; use one of ${FAKE_FIXTURES.join(', ')}`,
    )
  }
  if (env.EXPO_PUBLIC_SESSION_NO_ACCOUNT === '1') return 'newcomer'
  if (env.EXPO_PUBLIC_SESSION_FAKE_ROWS === '1') return 'rows'
  if (crowdPeers !== undefined) return 'crowd'
  return 'friends'
}

/** The world the environment names, and which fixture that was. */
export function pickFakeFixture(env: FakeDevEnv): FakeSetup & { fixture: FakeFixture } {
  const peers = positiveInt(
    'EXPO_PUBLIC_SESSION_FAKE_CROWD_PEERS',
    env.EXPO_PUBLIC_SESSION_FAKE_CROWD_PEERS,
  )
  const history = positiveInt(
    'EXPO_PUBLIC_SESSION_FAKE_CROWD_HISTORY',
    env.EXPO_PUBLIC_SESSION_FAKE_CROWD_HISTORY,
  )
  const fixture = chosenFixture(env, peers)
  switch (fixture) {
    case 'newcomer':
      return { fixture, ...newcomer() }
    case 'showcase':
      return { fixture, ...showcase() }
    case 'backlog':
      return { fixture, ...backlog() }
    case 'crowd':
      return { fixture, ...crowd({ peers: peers ?? 100, history: history ?? 1 }) }
    case 'rows':
      return { fixture, ...rowShowcase() }
    case 'friends':
      return { fixture, ...friendsWithAttachments(['Alice', 'Bob'], { history: 4 }) }
  }
}

/** The timers every JavaScript host has, named here because this package is typed for none. */
const timers = globalThis as unknown as {
  setInterval(run: () => void, ms: number): { unref?: () => void }
  clearInterval(handle: unknown): void
}

/** How often the dev loop drives the fake's clock. Real milliseconds, not the fake's. */
export const FAKE_TICK_MS = 50

/**
 * Runs the fake's clock for an app, since there is no test to advance it.
 *
 * `slowdown` is `EXPO_PUBLIC_SESSION_FAKE_SLOWDOWN`. Unset or 1, each tick drains the whole queue,
 * so a transfer finishes between two frames. Set to N, each tick advances only 1/N of the tick's
 * time, so every state lasts N times as long and a download is slow enough to watch the
 * placeholder, the bar, the ring and the footer change. Returns what stops it.
 */
export function driveFakeClock(world: FakeWorld, slowdown: string | undefined): () => void {
  const divisor = positiveInt('EXPO_PUBLIC_SESSION_FAKE_SLOWDOWN', slowdown) ?? 1
  const ticking = timers.setInterval(() => {
    if (divisor > 1) world.advance(FAKE_TICK_MS / divisor)
    else world.settle()
  }, FAKE_TICK_MS)
  // Node only: a dev clock must not keep a desktop main process alive by itself.
  ticking.unref?.()
  return () => {
    timers.clearInterval(ticking)
  }
}

/** The dev photographs as an app can see them. */
export interface DevPhotos {
  has: (fileName: string) => boolean
  /** Where the app reads them from, as it ends "The fake needs its dev photographs ...". */
  where: string
  /** The command that puts them there. */
  fix: string
}

/** A started dev fake: Alice is who the app is, `served` is her as the app's transport sees her. */
export interface DevFake {
  world: FakeWorld
  alice: FakeSessionClient
  served: SessionClient
}

/**
 * Starts an app's dev fake: checks the photographs, opens the world the environment names, runs
 * its clock, and fails the database when asked to.
 *
 * Refuses to start without every photograph, before anything opens, rather than draw a stand-in:
 * a fake that draws something else looks like it works and hides whether the pictures that would
 * really arrive are drawn right.
 */
export function startDevFake(env: FakeDevEnv, photos: DevPhotos): DevFake {
  const missing = [...photoFileNames(), ...thumbnailFileNames()].filter((name) => !photos.has(name))
  if (missing.length > 0) {
    throw new Error(
      `The fake needs its dev photographs ${photos.where}, and ${String(missing.length)} are ` +
        `missing. Run: ${photos.fix}`,
    )
  }

  const { world, clients } = pickFakeFixture(env)
  const alice = clients['Alice']
  if (!alice) throw new Error('the fixture did not produce a client')

  driveFakeClock(world, env.EXPO_PUBLIC_SESSION_FAKE_SLOWDOWN)

  // The failure screen is otherwise reachable only with a database somebody has already broken.
  // `unopenable` refuses with libsession's own reason and lets a discard through, so the screen's
  // Clear Device works here too.
  const served =
    env.EXPO_PUBLIC_SESSION_FAKE_FAILED_START === '1'
      ? unopenable(alice, 'file is not a database')
      : alice

  return { world, alice, served }
}
