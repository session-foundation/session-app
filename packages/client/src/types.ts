/**
 * What the app sees of libsession.
 *
 * One interface, three implementations: the Nitro module on mobile, the addon behind the
 * preload bridge on desktop, and the fake. Screens and stores are written against this and
 * cannot tell which one they have.
 *
 * The data types live in `@session/bridge-types`, which is also what the C++ is generated from,
 * so what a screen renders and what the shim fills are one declaration.
 */

import type {
  AccountInfo,
  AttachmentStatus,
  AutoDownload,
  Conversation,
  ConversationId,
  Deletion,
  FileServerConfig,
  Frame,
  Message,
  MessageCursor,
  Request,
  RouterKind,
  SeedNode,
  SessionEvent,
} from '@session/bridge-types'

export type Unsubscribe = () => void

/** Everything a network needs, so that attaching one is a single decision. */
export interface NetworkAttachment {
  netid: string
  /** Required for devnet, which libsession has no seeds of its own for. */
  seedNodes?: SeedNode[]
  fileServer?: FileServerConfig
  /** Defaults to session-router on mainnet and testnet, onion requests on devnet. */
  router?: RouterKind
}

export interface OutgoingMessage {
  body: string
  replyTo?: number
}

export interface SessionClient {
  /** Events arrive in the order libsession produced them, responses interleaved in place. */
  onEvent(listener: (event: SessionEvent) => void): Unsubscribe

  getAccountInfo(): Promise<AccountInfo>
  createAccount(): Promise<void>
  restoreAccount(from: { words: string[]; language?: string } | { hexSeed: string }): Promise<void>
  /** libsession owns the word list, so onboarding needs no mnemonic library of its own. */
  getSeedMnemonic(language?: string): Promise<string[]>
  setDisplayName(name: string): Promise<void>
  /**
   * Attach a network, or replace the one attached. Refused whole: a network that will not build
   * leaves the client on whatever it had.
   */
  attachNetwork(config: NetworkAttachment): Promise<void>
  /** One poll cycle, run to completion - what every OS background budget wants. */
  pollOnce(): Promise<void>
  /**
   * How often libsession polls the swarm. Its default of 20 seconds is about right for a
   * person and far too long for a test; a positive number of milliseconds is the only valid
   * argument.
   */
  setPollInterval(intervalMs: number): Promise<void>

  getConversations(): Promise<Conversation[]>
  getMessageRequests(): Promise<Conversation[]>
  getConversation(id: ConversationId): Promise<Conversation>
  openDm(sessionId: string): Promise<ConversationId>
  markRead(id: ConversationId, upTo?: number): Promise<void>
  setBlocked(id: ConversationId, blocked: boolean): Promise<void>
  setNickname(id: ConversationId, nickname?: string): Promise<void>
  setPriority(id: ConversationId, priority: number): Promise<void>
  approveConversation(id: ConversationId): Promise<void>
  deleteConversation(id: ConversationId, keepMessages?: boolean): Promise<void>

  /**
   * A page, and what its attachments are doing.
   *
   * The two come back together because a transfer has no stored state to look up afterwards: a
   * window built without them would draw every attachment as untouched and correct itself a
   * moment later. Attachments with nothing to fetch are absent rather than listed as idle.
   */
  getMessages(
    id: ConversationId,
    options?: { limit?: number; before?: MessageCursor; includeDeleted?: boolean },
  ): Promise<{ messages: Message[]; transfers: AttachmentStatus[] }>
  /**
   * Resolves as soon as libsession has stored the row, which is before it is sent. The states
   * that follow arrive as message-updated.
   */
  sendMessage(id: ConversationId, message: OutgoingMessage): Promise<number>
  /** Resumes a send that failed, and answers whether there was anything left to resume. */
  retrySend(messageId: number): Promise<boolean>
  deleteMessage(messageId: number, scope: Deletion): Promise<void>

  /**
   * Fetch an attachment into libsession's cache, reporting progress as `attachment-progress`
   * events. Also how a caller asks whether the bytes are already here: a cached file resolves at
   * once and reports nothing, and a fetch already running is joined rather than duplicated.
   */
  downloadAttachment(messageId: number, index: number): Promise<void>
  /** Resolves with where the file actually landed: a name collision becomes `name (2)`. */
  saveAttachment(
    messageId: number,
    index: number,
    destination: string,
    options?: { notifySender?: boolean; replace?: boolean },
  ): Promise<string>
  /** Also records that the question was asked, which is why `none` is worth sending. */
  setAutoDownload(id: ConversationId, mode: AutoDownload): Promise<void>
  /** Where libsession caches downloads. Empty when the bridge was opened without one. */
  getCacheDir(): Promise<string>
  /**
   * How much disk the cached attachments may occupy, evicted least-recently-used. Bytes on disk,
   * which is more than the files are: they are encrypted and padded. Undefined means no limit,
   * which is also the default - turning caching on without a bound is how a cache eats a disk.
   */
  getAttachmentCacheLimit(): Promise<number | undefined>
  setAttachmentCacheLimit(bytes?: number): Promise<void>

  getPref(key: string): Promise<string | undefined>
  setPref(key: string, value: string): Promise<void>

  close(): void
}

/** What a platform binding has to provide. Everything else is shared. */
export interface BridgeTransport {
  /** Submit a request. The reply arrives on the frame stream, not from here. */
  send(request: Request): void
  setSink(onFrame: (frame: Frame) => void): void
  close(): void
}
