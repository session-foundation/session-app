import type {
  AccountInfo,
  AttachmentTransfer,
  Conversation,
  ConversationId,
  ConversationList,
  Message,
  NetworkStatus,
  TransferProgress,
} from '@session/client'

import type { StartupFailureKind } from './startupFailure'

/** One of the two lists a conversation can be in, named as the state field holding it. */
export type ListName = Exclude<ConversationList, 'none'>

/**
 * One conversation's loaded history: a run of consecutive messages, which need not reach either
 * end of the conversation.
 *
 * `ready` is what tells an empty conversation apart from one nobody has asked for yet -
 * without it a transcript cannot know whether to render "no messages" or a spinner.
 */
export interface MessageWindow {
  ready: boolean
  /** Oldest first, ordered by (timestamp, id) as libsession orders history. */
  messages: Message[]
  /** Whether history goes on past the oldest message held, as libsession last said. */
  hasOlder: boolean
  /**
   * Whether history goes on past the newest message held. While it does, a message announced
   * beyond that end is not this window's to hold.
   */
  hasNewer: boolean
  /** The first page is being read. */
  fetching: boolean
  /**
   * The last read of the first page failed. Nothing asks for it again by itself: the transcript
   * asks whenever nothing is being read, so a failure that only cleared `fetching` would ask in a
   * loop. Reading it again clears this.
   */
  firstPageFailed: boolean
  /** Guard against asking for a page twice while the first request is still out. */
  fetchingOlder: boolean
  /** The last read of the page before the window failed; reading it again clears this. */
  olderPageFailed: boolean
}

export const emptyWindow: MessageWindow = {
  ready: false,
  messages: [],
  hasOlder: false,
  hasNewer: false,
  fetching: false,
  firstPageFailed: false,
  fetchingOlder: false,
  olderPageFailed: false,
}

/**
 * How one attachment transfer is going, as the reports left it.
 *
 * Per session and never persisted, because libsession stores nothing about a transfer either:
 * what is on this device is the attachment's `availability`, which libsession keeps current.
 */
export interface AttachmentTransferState extends TransferProgress {
  state: 'running' | 'done' | 'failed'
  /** The libsession code the failure carried, when `state` is `failed`. */
  error?: string
}

/**
 * Identifies a transfer among one message's, since one attachment can have a download and an
 * export at once.
 */
export function transferKey(transfer: AttachmentTransfer, index: number): string {
  return `${transfer}:${index}`
}

/** One message's live transfers, keyed by `transferKey`. */
export type MessageTransfers = Record<string, AttachmentTransferState>

export interface SessionState {
  hydrated: boolean
  account: AccountInfo | null
  /**
   * The most the file server takes in one upload, encrypted and padded, as libsession says: what
   * the composer quotes as the size limit. Null until a start has asked.
   */
  attachmentUploadLimitBytes: number | null

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
   * What kind of failure `startupError` is, which decides what the screen explains and whether it
   * offers a clear; null exactly when `startupError` is. See `classifyStartupFailure`.
   */
  startupFailureKind: StartupFailureKind | null

  /**
   * Complete lists, in libsession's order: read once, then kept by its placements. A placement
   * names the row it follows, so a partial copy would have nowhere to put one.
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
  /**
   * Which lists an event placed a row in after a row they do not hold, so they no longer match
   * libsession's and no later placement can put them right. The store reads that list again,
   * and the answer clears it.
   */
  listsOutOfStep: Record<ListName, boolean>

  histories: Record<ConversationId, MessageWindow>

  /**
   * Live transfers by message id, kept only for messages a loaded window holds: nothing draws a
   * transfer for a message no screen has, and an auto-downloading conversation would otherwise
   * grow this for the life of the session.
   */
  transfers: Record<number, MessageTransfers>

  /**
   * The theme and accent the account chose, as stored, or null where it has not chosen.
   *
   * Strings rather than the theme package's types: this package does not know which themes exist,
   * and a stored name a later build no longer ships has to fall back somewhere that does. Read with
   * the account, so a device with no account -- onboarding, or one just cleared -- has none: a
   * theme is the account's, and a distinctive one left behind would tie a cleared device back to
   * it.
   */
  appearance: StoredAppearance | null

  /**
   * Whether the recovery password was hidden on this device, which takes away the row that shows
   * it. Device-local, as on every legacy client: hiding it here says nothing about another device.
   */
  recoveryPasswordHidden: boolean

  /**
   * Whether the attached network can carry traffic, as libsession last said: asked once by
   * `hydrate`, then followed by its events. `unknown` until that first answer, which is
   * libsession's own word for a status nobody has reported yet.
   *
   * Not the account's, so nothing that empties the account's state is meant to keep it: every
   * such reset is followed by a `hydrate`, which asks again.
   */
  networkStatus: NetworkStatus
}

export interface StoredAppearance {
  theme: string
  accent: string
}

export const emptyState: SessionState = {
  hydrated: false,
  account: null,
  attachmentUploadLimitBytes: null,
  startupError: null,
  startupFailureKind: null,
  conversations: [],
  requests: [],
  listsOutOfStep: { conversations: false, requests: false },
  histories: {},
  transfers: {},
  appearance: null,
  recoveryPasswordHidden: false,
  networkStatus: 'unknown',
}
