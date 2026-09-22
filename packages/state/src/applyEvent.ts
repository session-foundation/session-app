import { ATTACHMENT_OK } from '@session/client'
import type { Conversation, ConversationId, Message, SessionEvent } from '@session/client'

import type { AttachmentTransferState, MessageWindow, SessionState } from './types'
import { transferKey } from './types'

/**
 * The whole projection, as one pure function.
 *
 * Every event carries complete state, so this only ever replaces - it never merges a delta
 * or goes back to ask for the rest. That is what makes replaying the same event twice
 * harmless, and what lets the store be seeded and then have earlier events land on top of
 * it without contradicting themselves.
 *
 * The objects the bridge hands over are stored as they are: this rebuilds the containers on the
 * path to a change (a map, an id array) and nothing inside them.
 */
export function applyEvent(state: SessionState, event: SessionEvent): SessionState {
  switch (event.type) {
    case 'conversation-added':
    case 'conversation-updated':
      return upsertConversation(state, event.conversation)

    case 'conversation-removed':
      return removeConversation(state, event.conversationId)

    case 'conversation-list-replaced':
      return { ...state, conversations: event.conversations }

    case 'request-list-replaced':
      return { ...state, requests: event.conversations }

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
        transfers: withoutConversation(state.transfers, event.conversationId),
      }

    case 'attachment-progress':
      return recordTransfer(state, event)

    case 'log':
      return state

    default:
      // A new SessionEvent arm is a compile error here, as it is in the shim and the fake.
      // Still returns state: a bridge newer than the app is survivable.
      event satisfies never
      return state
  }
}

/**
 * Records one report, dropping those for a conversation nobody has loaded.
 *
 * Same rule as a message event, and for the same reason: an auto-downloading conversation
 * reports whether or not anyone is looking at it, and keeping what no screen can draw would
 * leave this growing for the life of the session.
 */
function recordTransfer(
  state: SessionState,
  event: Extract<SessionEvent, { type: 'attachment-progress' }>,
): SessionState {
  if (!state.histories[event.conversationId]?.ready) return state

  const entry: AttachmentTransferState & { conversationId: ConversationId } = {
    conversationId: event.conversationId,
    // A result is what ends a transfer - `done === total` does not, and arrives before it.
    state:
      event.result === undefined
        ? 'running'
        : event.result === ATTACHMENT_OK
          ? 'done'
          : 'failed',
    done: event.done,
    total: event.total,
    ...(event.result === undefined ? {} : { result: event.result }),
  }

  return {
    ...state,
    transfers: {
      ...state.transfers,
      [transferKey(event.transfer, event.messageId, event.index)]: entry,
    },
  }
}

export function withoutConversation(
  transfers: SessionState['transfers'],
  id: ConversationId,
): SessionState['transfers'] {
  const kept = Object.entries(transfers).filter(([, t]) => t.conversationId !== id)
  return kept.length === Object.keys(transfers).length ? transfers : Object.fromEntries(kept)
}

type ListKey = 'conversations' | 'requests'

/**
 * The list without `id`, or the same array when it was not in it.
 *
 * Returning the same one matters: a screen subscribed to the request list would otherwise be
 * handed a new array on every message that arrives in a conversation, and re-render for a change
 * that never touched it.
 */
function without(list: Conversation[], id: ConversationId): Conversation[] {
  return list.some((c) => c.id === id) ? list.filter((c) => c.id !== id) : list
}

/**
 * Approval arrives as an update, not as a removal followed by an addition, so a row that
 * changed side has to be taken out of the list it used to be in. Missing this is what makes
 * a conversation appear in both lists at once.
 */
function upsertConversation(state: SessionState, conversation: Conversation): SessionState {
  const to: ListKey = conversation.request ? 'requests' : 'conversations'
  const from: ListKey = conversation.request ? 'conversations' : 'requests'

  const at = state[to].findIndex((c) => c.id === conversation.id)
  let target: Conversation[]
  if (at === -1) {
    // Appended, because where it belongs is not this file's decision: libsession orders the
    // lists, and the only case that moves a conversation between them - approval - is followed
    // by a replacement carrying the real order, so an appended row is corrected within the same
    // batch rather than left where it was put.
    target = [...state[to], conversation]
  } else {
    target = state[to].slice()
    target[at] = conversation
  }

  return { ...state, [from]: without(state[from], conversation.id), [to]: target }
}

function removeConversation(state: SessionState, id: ConversationId): SessionState {
  const { [id]: _history, ...histories } = state.histories

  return {
    ...state,
    conversations: without(state.conversations, id),
    requests: without(state.requests, id),
    histories,
    transfers: withoutConversation(state.transfers, id),
  }
}

/**
 * Adds or replaces a message, but only in a window that has already been loaded.
 *
 * Starting a window from a single event would leave a transcript that looks complete and is
 * not; the screen asks for the history it wants and events keep it current from there.
 */
function upsertMessage(
  state: SessionState,
  conversationId: ConversationId,
  message: Message,
): SessionState {
  const window = state.histories[conversationId]
  if (!window?.ready) return state

  const current = window.messages
  const existing = current.findIndex((m) => m.id === message.id)
  let messages: Message[]
  if (existing >= 0) {
    messages = current.slice()
    messages[existing] = message
  } else {
    // On the end, without checking where it belongs. The event reports a message that has just
    // happened, and libsession decides the order a transcript reads in - the shim already turns
    // its newest-first page around. A comparator here would be this package deciding it again.
    messages = [...current, message]
  }

  const updated: MessageWindow = { ...window, messages }
  return { ...state, histories: { ...state.histories, [conversationId]: updated } }
}

/**
 * An older page in front of what is already loaded.
 *
 * A concatenation and nothing else: the page was asked for from before the oldest message the
 * window holds, and both come from libsession in the order it reads them out, so joining them
 * is the whole operation.
 */
export function mergePages(older: Message[], previous: Message[]): Message[] {
  if (previous.length === 0) return older
  if (older.length === 0) return previous
  return [...older, ...previous]
}
