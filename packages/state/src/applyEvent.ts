import type {
  AttachmentRef,
  AttachmentTransfer,
  Conversation,
  ConversationId,
  ListPlacement,
  Message,
  SessionEvent,
} from '@session/client'

import type { AttachmentTransferState, ListName, MessageWindow, SessionState } from './types'
import { emptyWindow, transferKey } from './types'

/**
 * The whole projection, as one pure function.
 *
 * Every event carries complete state, so this only ever replaces - it never merges a delta
 * or goes back to ask for the rest. That is what makes replaying the same event twice
 * harmless.
 *
 * A conversation's position is the one relative thing: a placement puts a row after another, so
 * the lists stay right only when every event lands, in order, on top of lists read earlier on the
 * same stream. When one cannot be applied, `listsOutOfStep` says so and the store reads that
 * list again.
 *
 * The objects the bridge hands over are stored as they are: this rebuilds the containers on the
 * path to a change (a map, an id array) and nothing inside them.
 */
export function applyEvent(state: SessionState, event: SessionEvent): SessionState {
  switch (event.type) {
    case 'conversation-added':
    case 'conversation-updated':
      return placeConversation(state, event.conversation, event.placement)

    case 'conversation-removed':
      return removeConversation(state, event.conversationId)

    case 'messages-added':
    case 'messages-updated':
      // Folded one at a time rather than grouped by conversation first: a batch may span
      // conversations, and applying them in the order given is what makes the result the same
      // as a reload.
      return event.messages.reduce(
        (next, message) => upsertMessage(next, message.conversationId, message),
        state,
      )

    case 'history-replaced': {
      // Only the id comes back, so the window is dropped rather than patched: whatever is
      // left of it is no longer known to be true. The screen refetches.
      const window = state.histories[event.conversationId]
      return {
        ...state,
        histories: {
          ...state.histories,
          [event.conversationId]: emptyWindow,
        },
        transfers: withoutHistory(state.transfers, window?.messages ?? []),
      }
    }

    case 'attachment-progress':
      return recordTransfer(state, event)

    case 'network-status-changed':
      return state.networkStatus === event.status
        ? state
        : { ...state, networkStatus: event.status }

    case 'log':
      return state

    // Posted, taken down and counted by the platform (`followNotifications`), not drawn.
    case 'notification':
    case 'notifications-stale':
    case 'badge':
      return state

    default:
      // A new SessionEvent arm is a compile error here, as it is in the shim and the fake.
      // Still returns state: a bridge newer than the app is survivable.
      event satisfies never
      return state
  }
}

/**
 * Records one report, dropping those for a message no loaded window holds.
 *
 * By message, because a report names no conversation. A report that arrives between a message
 * being announced and it landing in a window is dropped; the bar starts on the next one.
 *
 * An upload is kept only while its message is `uploading`. libsession reports a file that fails
 * at once before the send has an id to report it by, so the bridge holds that report until after
 * the message has already been announced failed, and the failure is the message's to say.
 */
function recordTransfer(
  state: SessionState,
  event: Extract<SessionEvent, { type: 'attachment-progress' }>,
): SessionState {
  const message = loadedMessage(state, event.messageId)
  if (message === undefined) return state
  if (event.transfer === 'upload' && message.sendState !== 'uploading') return state

  const entry: AttachmentTransferState = {
    // An outcome ends a transfer; `doneBytes === totalBytes` does not, and arrives before it.
    state: event.outcome === undefined ? 'running' : event.outcome.ok ? 'done' : 'failed',
    doneBytes: event.doneBytes,
    totalBytes: event.totalBytes,
    ...(event.outcome?.error === undefined ? {} : { error: event.outcome.error }),
  }

  const transfers = state.transfers[event.messageId]
  const key = transferKey(event.transfer, event.index)
  // A download joined by a second handler reports every step once per handler.
  if (sameTransfer(transfers?.[key], entry)) return state

  return {
    ...state,
    transfers: { ...state.transfers, [event.messageId]: { ...transfers, [key]: entry } },
  }
}

/**
 * Records a command libsession refused before any transfer existed, as a failed one.
 *
 * Such a refusal reaches no event, so without this the only thing that knew was whichever caller
 * held the promise. A report that already said `failed` is left alone: it carries the real figures.
 */
export function recordRefusal(
  state: SessionState,
  transfer: AttachmentTransfer,
  ref: AttachmentRef,
): SessionState {
  if (state.transfers[ref.messageId]?.[transferKey(transfer, ref.index)]?.state === 'failed')
    return state
  return recordTransfer(state, {
    type: 'attachment-progress',
    transfer,
    messageId: ref.messageId,
    index: ref.index,
    doneBytes: 0,
    totalBytes: 0,
    outcome: { ok: false },
  })
}

function sameTransfer(
  stored: AttachmentTransferState | undefined,
  entry: AttachmentTransferState,
): boolean {
  return (
    stored !== undefined &&
    stored.state === entry.state &&
    stored.doneBytes === entry.doneBytes &&
    stored.totalBytes === entry.totalBytes &&
    stored.error === entry.error
  )
}

/** The message as a loaded window holds it, which is what makes a report worth keeping. */
function loadedMessage(state: SessionState, messageId: number): Message | undefined {
  for (const window of Object.values(state.histories)) {
    if (!window.ready) continue
    const message = window.messages.find((m) => m.id === messageId)
    if (message !== undefined) return message
  }
  return undefined
}

/** The transfers without those of the messages a dropped window held. */
export function withoutHistory(
  transfers: SessionState['transfers'],
  messages: readonly Message[],
): SessionState['transfers'] {
  const dropped = messages.filter((m) => m.id in transfers)
  if (dropped.length === 0) return transfers
  const kept = { ...transfers }
  for (const message of dropped) delete kept[message.id]
  return kept
}

/**
 * The list without `id`, or the same array when it was not in it.
 *
 * Returning the same one matters: a screen subscribed to the request list would otherwise be
 * handed a new array on every message that arrives in a conversation, and re-render for a change
 * that never touched it.
 */
function without(list: Conversation[], id: ConversationId): Conversation[] {
  const at = list.findIndex((c) => c.id === id)
  if (at === -1) return list
  const rest = list.slice()
  rest.splice(at, 1)
  return rest
}

/**
 * Takes the row out of whichever list holds it and puts it where the placement says.
 *
 * Both lists are searched rather than the placement's `from`, which is where libsession last
 * *reported* the row: a row the app read with `getConversations` and has not heard about since
 * is one libsession never reported, so its `from` is `none` while the app holds it. Both, even
 * once one is found to hold it: a list read after a row crossed, with the placement that crossed
 * it still to come, leaves the row in both until that placement lands.
 *
 * An `after` this store does not hold has no right answer, and appending would leave the row
 * somewhere plausible and wrong with nothing to correct it. It is appended all the same, so it
 * is not lost meanwhile, and the list is flagged for the store to read again.
 */
function placeConversation(
  state: SessionState,
  conversation: Conversation,
  { to, after }: ListPlacement,
): SessionState {
  const { id } = conversation
  if (to === 'none') {
    return {
      ...state,
      conversations: without(state.conversations, id),
      requests: without(state.requests, id),
    }
  }

  const other: ListName = to === 'conversations' ? 'requests' : 'conversations'
  const list = state[to]

  // Most changes leave a row where it is: a read receipt, a snippet, an unread count.
  const at = list.findIndex((c) => c.id === id)
  if (at !== -1 && (after === undefined ? at === 0 : list[at - 1]?.id === after)) {
    const kept = list.slice()
    kept[at] = conversation
    return { ...state, [to]: kept, [other]: without(state[other], id) }
  }

  const anchor = after === undefined ? -1 : list.findIndex((c) => c.id === after)
  // A row placed after itself names no row.
  const found = after === undefined || (anchor !== -1 && anchor !== at)
  const placed = list.slice()
  if (at !== -1) placed.splice(at, 1)
  // The anchor moved up one when the row came out from above it.
  const below = at !== -1 && at < anchor ? anchor : anchor + 1
  placed.splice(found ? below : placed.length, 0, conversation)

  return {
    ...state,
    [to]: placed,
    [other]: without(state[other], id),
    listsOutOfStep: found ? state.listsOutOfStep : { ...state.listsOutOfStep, [to]: true },
  }
}

function removeConversation(state: SessionState, id: ConversationId): SessionState {
  const { [id]: history, ...histories } = state.histories

  return {
    ...state,
    conversations: without(state.conversations, id),
    requests: without(state.requests, id),
    histories,
    transfers: withoutHistory(state.transfers, history?.messages ?? []),
  }
}

/** History's order: by timestamp, then id, so messages sharing a timestamp keep one order. */
function compareMessages(a: Message, b: Message): number {
  return a.timestamp - b.timestamp || a.id - b.id
}

/**
 * Whether a message the window does not hold belongs in it: between its ends, or past an end
 * that is also the conversation's. Past an end history goes on beyond, paging reads it.
 */
function belongsIn(window: MessageWindow, message: Message): boolean {
  const oldest = window.messages[0]
  const newest = window.messages[window.messages.length - 1]
  if (oldest === undefined || newest === undefined) return !window.hasOlder && !window.hasNewer
  if (compareMessages(message, newest) > 0) return !window.hasNewer
  if (compareMessages(message, oldest) < 0) return !window.hasOlder
  return true
}

/**
 * Adds or replaces a message, but only in a window that has already been loaded.
 *
 * Starting a window from a single event would leave a transcript that looks complete and is
 * not; the screen asks for the history it wants and events keep it current from there.
 *
 * Merged by id and placed by (timestamp, id): history is ordered by a message's own time, not by
 * arrival, and one stored just before a page was read is both in the page and announced after it.
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
    // A page leaves deleted messages out, so one the window does not hold stays out.
    if (message.deleted !== undefined || !belongsIn(window, message)) return state
    const after = current.findIndex((m) => compareMessages(m, message) > 0)
    const at = after === -1 ? current.length : after
    messages = [...current.slice(0, at), message, ...current.slice(at)]
  }

  const updated: MessageWindow = { ...window, messages }
  return {
    ...state,
    histories: { ...state.histories, [conversationId]: updated },
    transfers: withoutSettledTransfers(state.transfers, message),
  }
}

/**
 * A message's finished downloads, dropped once the message itself is announced: from then on its
 * `availability` says what they left, and a report kept past that would outlive an eviction.
 *
 * Its uploads go too once it is announced in any state but `uploading`: they were one attempt's,
 * `uploaded` says what that attempt left, and a retry reports its own from the start.
 */
function withoutSettledTransfers(
  transfers: SessionState['transfers'],
  message: Message,
): SessionState['transfers'] {
  const own = transfers[message.id]
  if (own === undefined) return transfers
  const uploadsOver = message.sendState !== 'uploading'
  const finished = message.attachments.flatMap((a) => {
    const download = transferKey('download', a.index)
    const upload = transferKey('upload', a.index)
    return [
      ...(own[download]?.state === 'done' ? [download] : []),
      ...(uploadsOver && upload in own ? [upload] : []),
    ]
  })
  if (finished.length === 0) return transfers
  const kept = { ...own }
  for (const key of finished) delete kept[key]
  return { ...transfers, [message.id]: kept }
}

/**
 * Two runs of history that meet, the older in front.
 *
 * A concatenation and nothing else: a page is asked for from past one end of the window, a
 * message announced past an end history goes on beyond is not taken into the window, and both
 * come from libsession in the order it reads them out, so joining them is the whole operation.
 */
export function mergePages(older: Message[], newer: Message[]): Message[] {
  if (newer.length === 0) return older
  if (older.length === 0) return newer
  return [...older, ...newer]
}
