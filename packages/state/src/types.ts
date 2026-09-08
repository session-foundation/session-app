import type {
  AccountInfo,
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
  /** Ascending by (timestamp, id): the order a transcript renders. */
  messages: Message[]
  oldestCursor?: MessageCursor
  exhausted: boolean
  /** Guards against firing a second page request while the first is still out. */
  fetching: boolean
}

export interface TransferProgress {
  messageId: number
  index: number
  done: number
  total: number
  result?: number
}

export interface SessionState {
  hydrated: boolean
  account: AccountInfo | null

  /** Complete lists. libsession sends whole state, so partial copies would only rot. */
  conversations: Record<ConversationId, Conversation>
  conversationOrder: ConversationId[]
  requests: Record<ConversationId, Conversation>
  requestOrder: ConversationId[]

  histories: Record<ConversationId, MessageWindow>
  transfers: Record<string, TransferProgress>
}

export const emptyState: SessionState = {
  hydrated: false,
  account: null,
  conversations: {},
  conversationOrder: [],
  requests: {},
  requestOrder: [],
  histories: {},
  transfers: {},
}

/** Pinned first, then most recent, then by id so the order never wobbles between renders. */
export function transferKey(messageId: number, index: number): string {
  return `${messageId}:${index}`
}
