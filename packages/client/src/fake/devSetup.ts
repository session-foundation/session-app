import type { RouterKind } from '@session/bridge-types'

import { friendsWithAttachments } from './attachments'
import { backlog } from './backlog'
import type { FakeSessionClient } from './FakeSessionClient'
import { dateStates } from './dates'
import { crowd, newcomer, type FakeSetup } from './fixtures'
import { photoFileNames, thumbnailFileNames } from './media'
import { FAKE_PATH_TRAFFIC, type FakePathTraffic } from './paths'
import { replies } from './replies'
import { rowShowcase } from './rows'
import { showcase } from './showcase'
import { keyMissing, keyUnavailable, type DatabaseKeyError } from '../databaseKey'
import { transcripts } from './transcripts'
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
  'dates',
  'transcripts',
  'replies',
  'repliesNearEnd',
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
  /** One of `FAKE_FAILED_STARTS`: a start that fails, and how, for the failure screen. */
  EXPO_PUBLIC_SESSION_FAKE_FAILED_START?: string | undefined
  /** One of `FAKE_PATH_TRAFFIC`: what the path screen shows. Unset is `quiet`. */
  EXPO_PUBLIC_SESSION_FAKE_PATHS?: string | undefined
  /**
   * How the network sends, as the real bridge reads it: `onion-requests` shows onion requests'
   * paths, `direct` none. Unset is libsession's default.
   */
  EXPO_PUBLIC_SESSION_ROUTER?: string | undefined
}

/**
 * The ways `EXPO_PUBLIC_SESSION_FAKE_FAILED_START` can fail a start, each refused as the real path
 * refuses it, so the startup-failure screen draws each class it tells apart:
 *
 * - `1`: SQLite's "file is not a database", a database opened with the wrong key. Unreadable.
 * - `corrupt`: "database disk image is malformed". Unreadable.
 * - `locked`: "database is locked", another process holding it. Transient.
 * - `full`: "database or disk is full". Transient.
 * - `key-unavailable`: the key is stored but the keychain will not give it up now. Transient.
 * - `key-missing`: the key is gone and the database is still there. Unreadable.
 *
 * Clear Device works on every one of them: a discard lifts the refusal.
 */
const FAKE_FAILED_STARTS = {
  '1': 'file is not a database',
  corrupt: 'database disk image is malformed',
  locked: 'database is locked',
  full: 'database or disk is full',
  'key-unavailable': keyUnavailable('the keychain is locked (the fake)'),
  'key-missing': keyMissing(),
} as const satisfies Record<string, string | DatabaseKeyError>

type FakeFailedStart = keyof typeof FAKE_FAILED_STARTS

/** Unset or empty as undefined; a value that is not one of `FAKE_FAILED_STARTS` is loud. */
function fakeFailedStart(raw: string | undefined): string | DatabaseKeyError | undefined {
  const text = raw?.trim()
  if (text === undefined || text === '') return undefined
  if (Object.hasOwn(FAKE_FAILED_STARTS, text)) return FAKE_FAILED_STARTS[text as FakeFailedStart]
  // Loud rather than a working start: a typo would otherwise look like the failure not happening.
  throw new Error(
    `EXPO_PUBLIC_SESSION_FAKE_FAILED_START=${text} is not a failure; use one of ` +
      Object.keys(FAKE_FAILED_STARTS).join(', '),
  )
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

const ROUTERS: readonly RouterKind[] = ['session-router', 'onion-requests', 'direct']

function chosenRouter(text: string | undefined): RouterKind | undefined {
  const named = text?.trim()
  if (named === undefined || named === '') return undefined
  if ((ROUTERS as readonly string[]).includes(named)) return named as RouterKind
  throw new Error(
    `EXPO_PUBLIC_SESSION_ROUTER=${named} is not a router; use one of ${ROUTERS.join(', ')}`,
  )
}

function chosenPathTraffic(text: string | undefined): FakePathTraffic {
  const named = text?.trim()
  if (named === undefined || named === '') return 'quiet'
  if ((FAKE_PATH_TRAFFIC as readonly string[]).includes(named)) return named as FakePathTraffic
  throw new Error(
    `EXPO_PUBLIC_SESSION_FAKE_PATHS=${named} is not a traffic; use one of ${FAKE_PATH_TRAFFIC.join(', ')}`,
  )
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
    case 'dates':
      return { fixture, ...dateStates() }
    case 'transcripts':
      return { fixture, ...transcripts() }
    case 'replies':
      return { fixture, ...replies() }
    case 'repliesNearEnd':
      return { fixture, ...replies({ nearEnd: true }) }
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
  const failure = fakeFailedStart(env.EXPO_PUBLIC_SESSION_FAKE_FAILED_START)
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
  world.pathTraffic = chosenPathTraffic(env.EXPO_PUBLIC_SESSION_FAKE_PATHS)
  // The dev loop settles the world rather than running its clock; paths follow the wall's.
  world.pathClock = () => Date.now()

  // The real bridge attaches the network it was opened with as soon as there is an account. The
  // fake is opened with none, so the dev entry asks here: a fixture with an account goes online at
  // once, and `newcomer` once onboarding makes one.
  const router = chosenRouter(env.EXPO_PUBLIC_SESSION_ROUTER)
  void alice.attachNetwork({ netid: 'mainnet', ...(router === undefined ? {} : { router }) })

  // The failure screen is otherwise reachable only with a database somebody has already broken.
  // `unopenable` refuses with libsession's own reason and lets a discard through, so the screen's
  // Clear Device works here too.
  const served = failure === undefined ? alice : unopenable(alice, failure)

  return { world, alice, served }
}
