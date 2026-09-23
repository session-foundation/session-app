import type {
  AccountInfo,
  AttachmentTransfer,
  Conversation,
  ConversationId,
  Message,
  MessageCursor,
} from '@session/client'

/**
 * One conversation's loaded history.
 *
 * `ready` is what tells an empty conversation apart from one nobody has asked for yet -
 * without it a transcript cannot know whether to render "no messages" or a spinner.
 */
export interface MessageWindow {
  ready: boolean
  /** In the order a transcript renders, which is the order libsession read them out. */
  messages: Message[]
  oldestCursor?: MessageCursor
  exhausted: boolean
  /** Guards against firing a second page request while the first is still out. */
  fetching: boolean
}

/**
 * How one attachment transfer is going, as the reports left it.
 *
 * Per session and never persisted, because libsession stores nothing about a transfer either:
 * what is on this device is answered by asking for it, not by a flag that can go stale.
 */
export interface AttachmentTransferState {
  state: 'running' | 'done' | 'failed'
  /** Encrypted bytes, so `done / total` is the only honest fraction - not `done / size`. */
  done: number
  /** Zero until the server says how big the file is, which is what "indeterminate" means here. */
  total: number
  result?: number
}

/** Identifies a transfer, since one attachment can have a download and a save at once. */
export function transferKey(
  transfer: AttachmentTransfer,
  messageId: number,
  index: number,
): string {
  return `${transfer}:${messageId}:${index}`
}

export interface SessionState {
  hydrated: boolean
  account: AccountInfo | null

  /**
   * Why the app could not start, or null while it still might.
   *
   * The only outcome of a start used to be `hydrated`, so a start that failed was
   * indistinguishable from one still running and the launch screen stayed up for ever. This is
   * the second outcome. It carries the message rather than a boolean because the message is the
   * only thing that tells anybody which failure it was, and there is nowhere else it survives.
   */
  startupError: string | null

  /**
   * Complete lists, in the order libsession sent them. libsession sends whole state, so partial
   * copies would only rot.
   *
   * A list and nothing beside it. libsession orders both queries in SQL and does not order them
   * the same way - conversations are `priority DESC, last_activity DESC, id`, requests are
   * `last_activity DESC, id` with no priority at all - so any order of this package's own
   * disagreed with one of the two. An index keyed by id was the other half of that arrangement,
   * and with the order gone it bought nothing: a screen renders the list, and the one lookup by
   * id is a `find` over an array already in memory.
   */
  conversations: Conversation[]
  requests: Conversation[]

  histories: Record<ConversationId, MessageWindow>

  /**
   * Live transfers, keyed by `transferKey`, alongside the conversation each belongs to so that
   * dropping a window drops its entries with it. Nothing draws a transfer for a conversation
   * whose history is gone, and an auto-downloading conversation would otherwise grow this for
   * the life of the session.
   */
  transfers: Record<string, AttachmentTransferState>
}

export const emptyState: SessionState = {
  hydrated: false,
  account: null,
  startupError: null,
  conversations: [],
  requests: [],
  histories: {},
  transfers: {},
}
