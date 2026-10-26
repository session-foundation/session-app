import type { Conversation, ConversationKind } from '@session/bridge-types'

import type { FakeSetup } from './fixtures'
import { FakeSessionClient } from './FakeSessionClient'
import { FakeWorld, resetFakeIds } from './world'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const MUTED_FOR_MS = 365 * DAY_MS

interface RowCase {
  name: string
  snippet?: string
  kind?: ConversationKind
  agoMs: number
  unread?: number
  markedUnread?: boolean
  pinned?: boolean
  muted?: boolean
  noteToSelf?: boolean
  request?: boolean
}

/**
 * One conversation per state the conversation row can draw, for looking at rather than asserting
 * on: each state on its own, the pairings that share a slot (a count beside a mute, a pin beside
 * an unread), every bracket of the timestamp, and one row with everything at once.
 *
 * Group and community rows exist only on the list: the fake has no group or community behind
 * them, so opening one shows an empty conversation.
 */
const CASES: readonly RowCase[] = [
  {
    name: 'Note to Self',
    snippet: 'Remember the milk',
    agoMs: 5 * MINUTE_MS,
    noteToSelf: true,
    pinned: true,
  },
  {
    name: 'Pinned, unread',
    snippet: 'Are you coming tonight?',
    agoMs: 2 * MINUTE_MS,
    unread: 3,
    pinned: true,
  },
  { name: 'Pinned, muted', snippet: 'Thanks!', agoMs: 3 * HOUR_MS, pinned: true, muted: true },
  { name: 'One unread', snippet: 'Hey', agoMs: MINUTE_MS, unread: 1 },
  {
    name: 'Unread, muted',
    snippet: 'Twelve messages you will not be told about',
    agoMs: 20 * MINUTE_MS,
    unread: 12,
    muted: true,
  },
  {
    name: 'Lots unread',
    snippet: 'More than the badge can count',
    agoMs: 40 * MINUTE_MS,
    unread: 150,
  },
  {
    name: 'Marked unread',
    snippet: 'Read, then marked unread',
    agoMs: 2 * HOUR_MS,
    markedUnread: true,
  },
  {
    name: 'Marked unread, muted',
    snippet: 'Marked unread while muted',
    agoMs: 5 * HOUR_MS,
    markedUnread: true,
    muted: true,
  },
  { name: 'Read, yesterday', snippet: 'See you tomorrow', agoMs: DAY_MS + HOUR_MS },
  { name: 'Read, this week', snippet: 'Sounds good', agoMs: 3 * DAY_MS },
  { name: 'Read, months ago', snippet: 'Happy birthday!', agoMs: 60 * DAY_MS },
  { name: 'Read, last year', snippet: 'Long time no see', agoMs: 400 * DAY_MS },
  { name: 'Group, read', kind: 'group', snippet: 'Dinner is at eight', agoMs: 4 * HOUR_MS },
  {
    name: 'Group, unread',
    kind: 'group',
    snippet: 'Who is bringing the cake?',
    agoMs: 10 * MINUTE_MS,
    unread: 5,
  },
  {
    name: 'Group, muted, unread',
    kind: 'group',
    snippet: 'Seven quiet messages',
    agoMs: 30 * MINUTE_MS,
    unread: 7,
    muted: true,
  },
  {
    name: 'Community, unread',
    kind: 'community',
    snippet: 'Welcome to the community',
    agoMs: 15 * MINUTE_MS,
    unread: 42,
  },
  {
    name: 'Community, muted',
    kind: 'community',
    snippet: 'Weekly update',
    agoMs: 2 * DAY_MS,
    muted: true,
  },
  { name: 'No messages yet', agoMs: 6 * DAY_MS },
  {
    name: 'Everything at once, with a name far too long to fit on the row',
    kind: 'group',
    snippet: 'A snippet long enough that it has to be cut off before the unread count at the end',
    agoMs: 8 * MINUTE_MS,
    unread: 1234,
    pinned: true,
    muted: true,
  },
  {
    name: 'A message request',
    snippet: 'Hi, we met at the conference',
    agoMs: 25 * MINUTE_MS,
    unread: 1,
    request: true,
  },
]

const hex = (n: number, length: number): string => n.toString(16).padStart(length, '0')

function idFor(index: number, kind: ConversationKind): string {
  // Not an address: these rows are only ever drawn, and app code names no URLs.
  if (kind === 'community') return `community-room-${String(index)}`
  return (kind === 'group' ? '03' : '05') + hex(index + 1, 64)
}

/** Every state the conversation row draws, one conversation each. */
export function rowShowcase(): FakeSetup {
  resetFakeIds()
  const world = new FakeWorld()
  const self = world.account('Alice')
  const now = Date.now()

  CASES.forEach((c, index) => {
    const kind = c.kind ?? 'dm'
    const conversation: Conversation = {
      id: c.noteToSelf ? self.sessionId : idFor(index, kind),
      kind,
      displayName: c.name,
      lastActivity: now - c.agoMs,
      priority: c.pinned ? 1 : 0,
      unreadCount: c.unread ?? 0,
      markedUnread: c.markedUnread ?? false,
      request: c.request ?? false,
      awaitingApproval: false,
      noteToSelf: c.noteToSelf ?? false,
      blocked: false,
      ...(c.snippet === undefined ? {} : { snippet: c.snippet }),
      ...(c.muted ? { muteUntil: now + MUTED_FOR_MS } : {}),
    }
    self.upsertConversation(conversation, { announce: false })
  })

  return { world, clients: { [self.displayName]: new FakeSessionClient(self, world) } }
}
