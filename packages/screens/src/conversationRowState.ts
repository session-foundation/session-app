import type { Conversation } from '@session/client'

/**
 * What a conversation list row shows, decided apart from how it is drawn so the rules can be
 * asserted without a renderer.
 */

/** The glyph that says what kind of conversation a row is; a one-to-one chat has none. */
type ConversationKindGlyph = 'bookmark' | 'usersRound' | 'globe'

/**
 * How loudly a row says it is unread. `notify` is the accent: the conversation would alert, or the
 * reader marked it unread themselves. `quiet` is unread that a mute keeps silent.
 */
export type UnreadTone = 'notify' | 'quiet'

type CountBadge = { kind: 'count'; label: string; tone: UnreadTone }
type MarkedUnreadBadge = { kind: 'markedUnread' }
export type UnreadBadge = CountBadge | MarkedUnreadBadge

export interface ConversationRowState {
  kindGlyph: ConversationKindGlyph | null
  /** Unread or marked unread: the name bolds and the time and snippet take the body colour. */
  emphasised: boolean
  pinned: boolean
  muted: boolean
  /** The strip down the leading edge; null on a read row. */
  strip: UnreadTone | null
  badge: UnreadBadge | null
}

/** Above this the count stops being read as a number and only says "a lot". */
const MAX_SHOWN_UNREAD = 9999

export function unreadCountLabel(count: number): string {
  return count > MAX_SHOWN_UNREAD ? `${MAX_SHOWN_UNREAD}+` : String(count)
}

function kindGlyph(
  conversation: Pick<Conversation, 'kind' | 'noteToSelf'>,
): ConversationKindGlyph | null {
  if (conversation.noteToSelf) return 'bookmark'
  if (conversation.kind === 'group') return 'usersRound'
  if (conversation.kind === 'community') return 'globe'
  return null
}

type RowFields = Pick<
  Conversation,
  'kind' | 'noteToSelf' | 'priority' | 'unreadCount' | 'markedUnread' | 'muteUntil'
>

/**
 * `nowMs` decides whether a mute is still in force; the row is not redrawn the moment one lapses,
 * only the next time the list is.
 */
export function conversationRowState(conversation: RowFields, nowMs: number): ConversationRowState {
  const muted = conversation.muteUntil !== undefined && conversation.muteUntil > nowMs
  const unread = conversation.unreadCount > 0
  // TODO: a mention cuts through a mute -- give it the accent strip and an @ pill beside the
  // count once mentions are detected, which arrives with groups.
  // TODO: libsession keeps a notifications setting (disabled, or mentions only) apart from the
  // mute time, and the bridge carries only the mute time, so a conversation whose notifications
  // were turned off on another client draws as loud here. Treat it as muted once the bridge
  // carries the setting.
  const tone: UnreadTone = muted ? 'quiet' : 'notify'

  let strip: UnreadTone | null = null
  let badge: UnreadBadge | null = null
  // Marking unread is the reader's own reminder, so it is loud even through a mute, and it stands
  // in for the count rather than sitting beside it.
  if (conversation.markedUnread) {
    strip = 'notify'
    badge = { kind: 'markedUnread' }
  } else if (unread) {
    strip = tone
    badge = { kind: 'count', label: unreadCountLabel(conversation.unreadCount), tone }
  }

  return {
    kindGlyph: kindGlyph(conversation),
    emphasised: unread || conversation.markedUnread,
    pinned: conversation.priority > 0,
    muted,
    strip,
    badge,
  }
}
