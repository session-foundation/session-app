import type { Conversation, ConversationId, Message, SessionEvent } from '@session/client'

import { transferKey, type MessageWindow, type SessionState } from './types'

/**
 * The whole projection, as one pure function.
 *
 * Every event carries complete state, so this only ever replaces - it never merges a delta
 * or goes back to ask for the rest. That is what makes replaying the same event twice
 * harmless, and what lets the store be seeded and then have earlier events land on top of
 * it without contradicting themselves.
 */
export function applyEvent(state: SessionState, event: SessionEvent): SessionState {
  switch (event.type) {
    case 'conversation-added':
    case 'conversation-updated':
      return upsertConversation(state, event.conversation)

    case 'conversation-removed':
      return removeConversation(state, event.conversationId)

    case 'conversation-list-replaced':
      return { ...state, ...indexConversations(event.conversations, 'conversations') }

    case 'request-list-replaced':
      return { ...state, ...indexConversations(event.conversations, 'requests') }

    case 'message-added':
    case 'message-updated':
      return upsertMessage(state, event.conversationId, event.message)

    case 'history-replaced':
      // Only the id comes back, so the window is dropped rather than patched: whatever is
      // left of it is no longer known to be true. The screen refetches.
      return {
        ...state,
        histories: {
          ...state.histories,
          [event.conversationId]: {
            ready: false,
            messages: [],
            exhausted: false,
            fetching: false,
          },
        },
      }

    case 'attachment-progress':
      return applyTransfer(state, event.progress)

    case 'display-picture-progress':
    case 'log':
      return state

    default:
      return state
  }
}

function indexConversations(
  conversations: Conversation[],
  target: 'conversations' | 'requests',
): Partial<SessionState> {
  const byId: Record<ConversationId, Conversation> = {}
  for (const conversation of conversations) byId[conversation.id] = conversation
  // Arrival order, not our own. libsession orders both queries in SQL, and it does not order them
  // the same way: conversations are `priority DESC, last_activity DESC, id`, requests are
  // `last_activity DESC, id` with no priority at all. One comparator applied to both did not
  // merely repeat work already done - it imposed a priority ordering on the request list that
  // libsession does not apply, and it would have gone on disagreeing with any later change to
  // libsession's sort rules.
  const order = conversations.map((c) => c.id)

  return target === 'conversations'
    ? { conversations: byId, conversationOrder: order }
    : { requests: byId, requestOrder: order }
}

/**
 * Approval arrives as an update, not as a removal followed by an addition, so a row that
 * changed side has to be taken out of the list it used to be in. Missing this is what makes
 * a conversation appear in both lists at once.
 */
function upsertConversation(state: SessionState, conversation: Conversation): SessionState {
  const intoRequests = conversation.request
  const from = intoRequests ? 'conversations' : 'requests'
  const fromOrder = intoRequests ? 'conversationOrder' : 'requestOrder'
  const to = intoRequests ? 'requests' : 'conversations'
  const toOrder = intoRequests ? 'requestOrder' : 'conversationOrder'

  const { [conversation.id]: _removed, ...withoutFromOther } = state[from]
  const target = { ...state[to], [conversation.id]: conversation }

  // The row keeps its place, and a row arriving from the other list goes on the end. Neither is
  // this file's decision to make: libsession orders the lists, and the only case that moves a
  // conversation between them - approval - is followed by a replacement carrying the real order,
  // so an appended row is corrected within the same batch rather than left where it was put.
  const already = state[toOrder].includes(conversation.id)
  const order = already ? state[toOrder] : [...state[toOrder], conversation.id]

  return {
    ...state,
    [from]: withoutFromOther,
    [fromOrder]: state[fromOrder].filter((id) => id !== conversation.id),
    [to]: target,
    [toOrder]: order,
  }
}

function removeConversation(state: SessionState, id: ConversationId): SessionState {
  const { [id]: _fromList, ...conversations } = state.conversations
  const { [id]: _fromRequests, ...requests } = state.requests
  const { [id]: _history, ...histories } = state.histories

  return {
    ...state,
    conversations,
    requests,
    histories,
    conversationOrder: state.conversationOrder.filter((each) => each !== id),
    requestOrder: state.requestOrder.filter((each) => each !== id),
  }
}

/**
 * Adds or replaces a message, but only in a window that has already been loaded.
 *
 * Starting a window from a single event would leave a transcript that looks complete and is
 * not; the screen asks for the history it wants and events keep it current from there.
 */
/**
 * Place one message, rather than re-sorting the transcript around it.
 *
 * This ordering is not libsession's repeated: libsession returns a page newest-first and a
 * transcript reads oldest-first, so the reversal is ours and has to stay. What does not have to
 * stay is sorting the whole window on every arrival. A message almost always belongs at the end -
 * it just arrived - so the scan starts there and usually stops immediately, and an out-of-order
 * backfill still lands in the right place.
 */
function insertInOrder(messages: Message[], message: Message): Message[] {
  const before = (m: Message) =>
    m.timestamp < message.timestamp || (m.timestamp === message.timestamp && m.id < message.id)

  let at = messages.length
  while (at > 0 && !before(messages[at - 1] as Message)) at--

  if (at === messages.length) return [...messages, message]
  return [...messages.slice(0, at), message, ...messages.slice(at)]
}

function upsertMessage(
  state: SessionState,
  conversationId: ConversationId,
  message: Message,
): SessionState {
  const window = state.histories[conversationId]
  if (!window?.ready) return state

  const existing = window.messages.findIndex((m) => m.id === message.id)
  const messages =
    existing >= 0
      ? window.messages.map((m) => (m.id === message.id ? message : m))
      : insertInOrder(window.messages, message)

  const updated: MessageWindow = { ...window, messages }
  return { ...state, histories: { ...state.histories, [conversationId]: updated } }
}

function applyTransfer(
  state: SessionState,
  progress: { messageId: number; index: number; done: number; total: number; result?: number },
): SessionState {
  const key = transferKey(progress.messageId, progress.index)

  // A report carrying a result is the last one for that index, so the entry retires rather
  // than sitting at 100% for ever.
  if (progress.result !== undefined) {
    const { [key]: _done, ...transfers } = state.transfers
    return { ...state, transfers }
  }

  return { ...state, transfers: { ...state.transfers, [key]: { ...progress } } }
}
