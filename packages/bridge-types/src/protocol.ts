import type {
  AccountInfo,
  AttachmentStatus,
  AttachmentTransfer,
  AutoDownload,
  Conversation,
  ConversationId,
  Deletion,
  Message,
  MessageCursor,
} from './domain'
import type { FileServerConfig, RouterKind, SeedNode } from './sessionBridgeOptions'

/**
 * Bytes carrying a secret, transferred rather than copied and wiped once they land.
 *
 * **A distinct spelling rather than a plain `Uint8Array`**, because the generator matches on it:
 * ordinary bytes become a `std::vector` and one of these becomes a buffer whose destructor zeroes
 * it. Naming the secret in the protocol is what makes it handled as a secret everywhere it lands,
 * rather than everywhere somebody remembered.
 *
 * The sender's buffer is detached by `postMessage(request, [buffer])`, so the bytes exist in one
 * process instead of two. That is the copy the sender can never reach to clear afterwards.
 *
 * Not exported: the generator reads the annotation on the field rather than an import of this, and
 * TypeScript has nothing to gain from a second name for `Uint8Array`.
 */
type SecretBytes = Uint8Array

/**
 * Everything the app asks libsession to do. One Request goes in, exactly one Response comes
 * back carrying the same id. Commands are named for what the app wants, not for the C++ method
 * that serves them, so that a refactor upstream is a shim change rather than a protocol change.
 *
 * **The protocol is one ordered stream**: what goes in, what comes out.
 *
 * Responses ride the same stream as change events rather than resolving on a separate channel,
 * because their relative order is load-bearing. libsession's contract is that a display can be
 * built by asking once and then applying events; that only holds if a list_replaced produced
 * before the answer to getConversations is also applied before it. Two channels - a promise and
 * a callback - give no such guarantee across an IPC or JSI boundary, and the failure would be a
 * stale row that reappears on a race nobody can reproduce. One FIFO stream carries libsession's
 * own ordering through to TypeScript; the facade still hands callers promises, resolved from
 * `Response` frames.
 *
 * Every union here is discriminated on a literal `type`, and every field is a string, number,
 * boolean, string-union enum, another interface, or an array of one: that is the subset the C++
 * generator understands, and it refuses anything else.
 */
export type Command =
  // Lifecycle and account
  | { type: 'getAccountInfo' }
  | { type: 'createAccount' }
  /**
   * **The words are strings, and that is the known weak point of the whole seed story.**
   *
   * A JavaScript string cannot be wiped, and by the time a phrase reaches here it exists several
   * times over -- the field's value, the state holding it, the array split out of it, the copy
   * cloned across the process boundary -- none of which can be cleared, only abandoned.
   *
   * **Two separate improvements are available here, and only one of them costs anything.**
   *
   * The cheap one is this field: bytes *transferred* rather than a string array copied.
   * `postMessage(request, [buffer])` detaches the sender's `ArrayBuffer`, so the bytes exist in
   * one process instead of two and the shim can zero them with `fill(0)` when it is done. That
   * removes the copy in the *other* process, which is the one the renderer could never reach to
   * clear afterwards. It costs nothing anybody would notice: the phrase is still typed and still
   * pasted, and is encoded on its way out. The generator has had the type since the typed-frame
   * work -- `bytes`, and a secret variant whose C++ zeroes in its destructor -- so this is a
   * change to this field, to the shim that reads it, and to whatever encodes the words before
   * sending.
   *
   * The expensive one is the other three copies -- the field's value, the state holding it, the
   * array split out of it -- and those are unavoidable while a phrase is collected as text.
   * Removing them means collecting it without a text field, which **gives up paste**, and a phrase
   * arrives pasted from a password manager at least as often as it is typed. That is the trade
   * being declined, and every current client declines it the same way.
   *
   * So doing the first does not finish the story, and is worth doing anyway.
   */
  | { type: 'restoreAccountFromWords'; phrase: SecretBytes; language?: string }
  /**
   * Ask whether a recovery phrase would restore, without restoring it.
   *
   * Onboarding has to say a phrase is wrong while it can still be fixed, and
   * `restoreAccountFromWords` answers that by doing it -- leaving an identity behind that going
   * back cannot take away. This decodes and throws the result away, so when to mint stays at the
   * end of the flow, as it already is for a new account.
   *
   * Succeeds or fails; the seed deliberately does not come back, since the words are already in
   * the app's memory and a second copy of the same secret buys nothing.
   */
  | { type: 'checkRecoveryPhrase'; phrase: SecretBytes; language?: string }
  | { type: 'restoreAccountFromSeed'; hexSeed: string }
  /**
   * Throws away the account and everything stored under it, and starts again from nothing.
   *
   * **Onboarding's undo.** The identity, the configs fetched under it and the message history all
   * have to go rather than stop being displayed, which means the database: this closes libSession,
   * deletes it and opens a fresh one on the same path.
   *
   * Deliberately **not** a way to "log out" -- there is nothing to log back in to. It is the same
   * act as never having onboarded.
   *
   * The network cache is left alone: it holds the public service-node list and nothing about any
   * account, and it is what makes the next attempt fast.
   */
  | { type: 'discardAccount' }
  /**
   * Says the account is here to stay, and stops it being swept away on the next start.
   *
   * **An account is provisional until this is called.** Between `createAccount` and the end of
   * onboarding there is a window where an identity exists that nobody finished setting up, and a
   * crash in it leaves that behind. The next start sees nothing ever confirmed it and throws it
   * away, so the person begins again rather than inheriting a half-made account.
   *
   * **Which matters most for a restore**: one recovered but never confirmed has the right identity
   * and no display name, and asking for a name would overwrite the one the account already has on
   * the network.
   *
   * Not called "finish onboarding": the bridge has no notion of it, and a client that never
   * onboards calls this once after `createAccount` and is done.
   */
  | { type: 'keepAccount' }
  | { type: 'getSeedMnemonic'; language?: string }
  | { type: 'setDisplayName'; name: string }
  /**
   * Attach a network, or replace the one attached. Declining to attach is how an app stays
   * offline, and that is an init option rather than a command.
   *
   * Carries everything the network needs rather than leaving half of it remembered from init, so
   * that a refusal leaves the client on whatever it had. "mainnet", "testnet" or "devnet".
   */
  | {
      type: 'attachNetwork'
      netid: string
      seedNodes?: SeedNode[]
      fileServer?: FileServerConfig
      /** Defaults to session-router on mainnet and testnet, onion requests on devnet. */
      router?: RouterKind
    }
  /**
   * Fill the service-node cache before there is an account to use it, so the first attach is not
   * also the first refresh.
   *
   * **Takes no arguments on purpose.** It warms the network the client would attach -- the one
   * given at init -- because a cache warmed for any other is a cache the attach cannot use, and a
   * netid passed separately could disagree with it.
   *
   * Answers true when the pool has nodes in it. Refused, with false, where there is nothing to
   * warm or nothing to gain: no network configured, a network already attached (two live Networks
   * would both refresh), or a warm already in flight.
   *
   * The instance is dropped before the client attaches rather than left beside it, which is what
   * makes this a warm rather than a second network.
   */
  | { type: 'warmNetworkCache' }
  /**
   * How often libsession polls the swarm, in milliseconds. Its default is 20 seconds, which is a
   * long time to wait for a test and about right for a person.
   *
   * Takes effect by replacing the running ticker, so the next poll is a full interval away rather
   * than when the old one would have fired; setting it before a network is attached therefore
   * costs no initial delay. Nothing serialises polls against each other, so an interval short
   * enough that one is still outstanding when the next fires gets overlapping requests - wasteful
   * rather than wrong, since a handler already has to tolerate seeing a message twice.
   *
   * The floor is 1ms: zero or negative is refused rather than read as "never" or "always".
   */
  | { type: 'setPollInterval'; intervalMs: number }
  /**
   * Run one poll cycle to completion: the primitive every OS background budget wants. Android's
   * WorkManager job, iOS's BGAppRefreshTask and a push-triggered fetch all reduce to it.
   */
  | { type: 'pollOnce' }
  | { type: 'setPushToken'; platform: string; token: string }
  /**
   * Interpret a push payload far enough to notify. Answering from the payload alone matters on
   * iOS, where the notification service extension runs while the app holds the database.
   */
  | { type: 'handlePushPayload'; payloadHex: string }
  // Conversations
  | { type: 'getConversations' }
  | { type: 'getMessageRequests' }
  | { type: 'getConversation'; conversationId: ConversationId }
  | { type: 'openDm'; sessionId: string }
  | { type: 'markRead'; conversationId: ConversationId; upTo?: number }
  | { type: 'setBlocked'; conversationId: ConversationId; blocked: boolean }
  | { type: 'setNickname'; conversationId: ConversationId; nickname?: string }
  | { type: 'setPriority'; conversationId: ConversationId; priority: number }
  | { type: 'approveConversation'; conversationId: ConversationId }
  | { type: 'deleteConversation'; conversationId: ConversationId; keepMessages: boolean }
  // Messages
  | {
      type: 'getMessages'
      conversationId: ConversationId
      limit: number
      before?: MessageCursor
      includeDeleted: boolean
    }
  | { type: 'sendMessage'; conversationId: ConversationId; body: string; replyTo?: number }
  | { type: 'retrySend'; messageId: number }
  | { type: 'deleteMessage'; messageId: number; scope: Deletion }
  // Attachments. Nothing here carries bytes: a transfer is reported by `attachment-progress`
  // events, and the file itself is reached by the media scheme each platform resolves natively.
  /**
   * Fetch an attachment into libsession's cache, reporting progress as it goes.
   *
   * One call covers all three cases: it answers at once when the file is already cached, joins a
   * fetch already running - reporting from wherever that has got to - and starts one only when
   * nothing else has. So it is also how a caller asks whether the bytes are here.
   */
  | { type: 'downloadAttachment'; messageId: number; index: number }
  /**
   * Write an attachment to a path the person chose, fetching it first if the cache does not hold
   * it. Reads the cache but never fills it, so this is not a way to pre-fetch.
   */
  | {
      type: 'saveAttachment'
      messageId: number
      index: number
      destination: string
      notifySender: boolean
      replace: boolean
    }
  /** Also records that the question was asked at all, which is why `none` is worth sending. */
  | { type: 'setAutoDownload'; conversationId: ConversationId; mode: AutoDownload }
  /**
   * The directory libsession was given to cache downloads in.
   *
   * Asked for rather than read back from the options the app passed, because the app that passed
   * them is not always the one that draws them: the desktop renderer is sandboxed and the path
   * was chosen in the main process.
   */
  | { type: 'getCacheDir' }
  | { type: 'getAttachmentCacheLimit' }
  /**
   * How much disk the cached attachments may occupy, evicted least-recently-used. Bytes on disk,
   * which is what caching actually costs: the files are encrypted and padded, so the total is
   * larger than the same attachments as plain files. Unset means no limit.
   */
  | { type: 'setAttachmentCacheLimit'; bytes?: number }
  // App preferences, stored in libsession's globals table so they sit beside the account
  // instead of in a second store the app would have to keep in step.
  | { type: 'getPref'; key: string }
  | { type: 'setPref'; key: string; value: string }
  // Served by the shim only under SESSION_BRIDGE_TESTING; every other build answers with an
  // error naming the command. These are what let the contract suite drive the real bridge with
  // no network: one client's messages are carried to the other by the harness, encrypted and fed
  // in the way the swarm would have done it. A port of libsession's own test helpers
  // (tests/test_client/common.hpp), not a second way to do anything the app does.
  /**
   * Builds, encrypts and delivers a v1 DM as if it had arrived from the swarm. The sender is
   * whoever holds `senderSeedHex`, a 32-byte account seed; the recipient is always the client
   * the command is sent to, since that is the only account it can decrypt for.
   */
  | { type: 'deliverTestMessage'; senderSeedHex: string; body: string; timestamp: number }
  /** This client's own account seed, so the harness can forge messages from it to another. */
  | { type: 'getTestAccountSeed' }
  /**
   * Marks a contact approved, which is what having written to them would have done. Setup for
   * scenarios about something else: without it a first message is a request and the list the
   * test asks about is empty.
   */
  | { type: 'approveTestContact'; sessionId: string }
  /**
   * Emits the given frame verbatim onto the stream. Every converter in both directions runs on
   * every field of every output type, which is the round-trip test of the generated C++.
   */
  | { type: 'echoTestFrame'; frame: Frame }

export interface Request {
  id: number
  command: Command
}

/** What a Response carries when the command succeeded. */
export type Result =
  | { type: 'empty' }
  | { type: 'accountInfo'; info: AccountInfo }
  | { type: 'mnemonic'; words: string[] }
  | { type: 'conversationList'; conversations: Conversation[] }
  | { type: 'conversation'; conversation: Conversation }
  /**
   * Oldest first, whatever page it is - the direction a transcript is read. libsession answers
   * newest first because that is the direction paging runs; the shim reverses. Getting this
   * wrong shows up as a conversation that reads bottom to top.
   */
  /**
   * A page, and what its attachments are doing.
   *
   * The two travel together because a transfer has no stored state to look up later: a window
   * that arrived without them would draw every attachment as untouched and then correct itself.
   * Deliberately not fields on `Attachment` - that is libsession's account of the message, and
   * this is what this device is doing about it, which changes far more often and is also what
   * `attachment-progress` reports. One writer for the first picture, one for the updates.
   *
   * Attachments with nothing to fetch are absent rather than listed as idle.
   */
  | { type: 'messageList'; messages: Message[]; transfers: AttachmentStatus[] }
  | { type: 'messageId'; messageId: number }
  | { type: 'hex'; hex: string }
  | { type: 'pref'; value?: string }
  | { type: 'bool'; value: boolean }
  /** Where a save landed, which is not always where it was asked to go: a collision becomes `name (2)`. */
  | { type: 'path'; path: string }
  /** Unset means no limit. */
  | { type: 'byteCount'; bytes?: number }

export interface Response {
  id: number
  /**
   * libsession reports failures as text - usually SQLite's own message. Deliberately not an
   * enum: the message says which constraint, and inventing codes would throw that away. Set
   * instead of `result`, never beside it.
   */
  error?: string
  result?: Result
}

/**
 * Change notifications, one per libsession callback, and what `SessionClient.onEvent` delivers.
 *
 * Every one of these carries the whole new state rather than an id to go and fetch. That is what
 * makes a display bindable, applying the same event twice harmless, and startup race-free:
 * whatever arrives between construction and the first query lands on top of the answer without
 * contradicting it.
 *
 * The shim emits these and the app reads them, with nothing in between rewriting an arm - which
 * is why there is one type rather than a wire one and an app one.
 *
 * `attachment-progress` is the one arm that is not whole state, because a transfer has none to
 * carry: libsession stores nothing about one in flight, and the report is the only record there is.
 */
export type SessionEvent =
  | { type: 'conversation-added'; conversation: Conversation }
  | { type: 'conversation-updated'; conversation: Conversation }
  | { type: 'conversation-removed'; conversationId: ConversationId }
  | { type: 'conversation-list-replaced'; conversations: Conversation[] }
  | { type: 'request-list-replaced'; conversations: Conversation[] }
  | { type: 'message-added'; conversationId: ConversationId; message: Message }
  | { type: 'message-updated'; conversationId: ConversationId; message: Message }
  | { type: 'history-replaced'; conversationId: ConversationId }
  /**
   * One report about one attachment transfer, whether a command asked for it or libsession
   * started it on its own.
   *
   * The first report of a transfer is `{done: 0, total: 0}` and means it started - `total` stays 0
   * until the server says how big the file is. `result` absent means still going; `result === 0`
   * means accepted and verified and is the only thing that means finished, since `done === total`
   * does not. Any other value is a failure: a file server status, a negative network code, or one
   * of the ATTACHMENT_* sentinels. Exactly one report per transfer carries a result.
   *
   * Reports for one (transfer, messageId, index) are ordered; different ones interleave, and each
   * is rate limited to roughly one per 100ms. A transfer served from the cache reports nothing at
   * all, so an indicator must be driven by time rather than by these arriving.
   *
   * `done` and `total` count *encrypted* bytes - what is actually being moved - and so do not
   * agree with `Attachment.size`, which is the plaintext length.
   */
  | {
      type: 'attachment-progress'
      transfer: AttachmentTransfer
      /** So a screen can drop what it is not showing: an auto-downloading conversation reports
       *  whether or not anyone is looking at it. */
      conversationId: ConversationId
      messageId: number
      index: number
      done: number
      total: number
      result?: number
    }
  /**
   * libsession's own log lines, forwarded when the bridge was opened with a log level. Worth
   * having because the state machine reports what happened and never why.
   */
  | { type: 'log'; message: string; category: string; level: string }

/** Everything the shim sends back, in the order libsession produced it. */
export type Frame =
  { type: 'response'; response: Response } | { type: 'event'; event: SessionEvent }
