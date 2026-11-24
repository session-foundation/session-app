import type {
  AccountInfo,
  AttachmentOutcome,
  AttachmentTransfer,
  AutoDownload,
  ConfigSize,
  Conversation,
  ConversationId,
  ConversationList,
  Deletion,
  ListPlacement,
  Message,
  MessageCursor,
  NetworkPaths,
  NetworkStatus,
  OutgoingAttachment,
  NotificationContent,
  NotificationSound,
  PushService,
  SendPlan,
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

/** A file a forged message says it carries: a pointer to nothing, so it never downloads. */
// Not exported: only the request below names it, and the generator reads it from this file.
interface TestAttachment {
  contentType: string
  /** Unset is a sender who sent no ThumbHash, which is what leaves `hasThumbhash` false. */
  thumbhash?: Uint8Array
  /** Sent as the sender's original file, which is what leaves `originalFile` true. */
  originalFile?: boolean
}

/** The message a forged message says it answers, named as the wire names one. */
// Not exported, as `TestAttachment` is not.
interface TestQuote {
  author: string
  timestamp: number
}

/**
 * Everything the app asks libsession to do. One Request goes in, exactly one Response comes
 * back carrying the same id. Commands are named for what the app wants, not for the C++ method
 * that serves them, so that a refactor upstream is a shim change rather than a protocol change.
 *
 * **The protocol is one ordered stream**: what goes in, what comes out.
 *
 * Responses ride the same stream as change events rather than resolving on a separate channel,
 * because their relative order is load-bearing. libsession's contract is that a display can be
 * built by asking once and then applying events; that only holds if a placement produced
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
  /**
   * Restore from a seed in hex: 16 bytes (32 characters), as every recovery password QR code
   * carries, or the full 32 bytes. A 16-byte seed is the lower half, the upper half zero -- the
   * same seed the 13 words decode to.
   */
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
  /**
   * The recovery password's words, answered with a `mnemonic` result, or `seedHidden` once
   * `hideRecoveryPassword` has been called on this device.
   */
  | { type: 'getSeedMnemonic'; language?: string }
  /**
   * The account seed as lowercase hex, answered with a `hex` result: what a recovery password's
   * QR code carries. `seedHidden` instead once `hideRecoveryPassword` has been called.
   *
   * **16 bytes (32 characters) when the seed's upper half is zero**, which is every account the
   * 13 words describe, and 32 bytes otherwise. The short form is the one every existing client
   * puts in that QR and reads back from it, so a code drawn from this scans anywhere.
   * `restoreAccountFromSeed` takes either length.
   */
  | { type: 'getSeedHex' }
  /**
   * Hides the recovery password on this device for good, answered with an empty result once it is
   * stored. From then on `getSeedMnemonic` and `getSeedHex` answer `seedHidden`, so nothing above
   * the bridge can read the seed back out; the account itself, and every key derived from the
   * seed, carry on as before. There is no way back, as on every legacy client.
   */
  | { type: 'hideRecoveryPassword' }
  /** Whether `hideRecoveryPassword` has been called on this device, answered with a `bool`. */
  | { type: 'getRecoveryPasswordHidden' }
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
   * Whether the attached network can carry traffic now. `disconnected` where none is attached.
   *
   * Asked once and then followed by `network-status-changed`, the way every list here is: a
   * renderer that reloads, or a store that subscribes after the network came up, has missed the
   * events that said so.
   */
  | { type: 'getNetworkStatus' }
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
  /**
   * Closes the database before the OS suspends the process: destroys the Client once it has no
   * outbound work left or after `waitMs`, whichever is first. If destroying it is still not done
   * `interruptMs` after the command, the database's SQL is interrupted so that it can finish, and
   * whatever statement was running is rolled back.
   *
   * For iOS, which kills a suspended app holding a lock on a file in its shared container
   * (0xdead10cc), and the database is in the app group so the notification extension can open
   * it. While it waits, the Client works as before and `reopenClient` cancels the close; once it is
   * destroying, every request but `reopenClient` is refused at once rather than left waiting.
   * Answers `clientClosed`.
   */
  | { type: 'closeClient'; waitMs: number; interruptMs: number }
  /**
   * Undoes `closeClient`: cancels it while it is still waiting for outbound work, or builds the
   * Client again and attaches its network once it has closed. Answers `ok` when the Client is
   * there again; nothing to do if it never closed.
   */
  | { type: 'reopenClient' }
  /**
   * Stops or restarts fetching new messages: no polling and no swarm subscription while off, and
   * whatever the subscribed node still pushes is ignored, to be fetched by the first poll after
   * receiving restarts. Sends and uploads carry on. For iOS, as the app leaves the screen, so that
   * its notification extension receives meanwhile. Answers `ok`; refused while the Client is
   * closed. A Client built again by `reopenClient` receives.
   */
  | { type: 'setReceiving'; on: boolean }
  /**
   * Subscribes this device to pushes for the account through `service`, or renews or changes its
   * subscription; `token` is what the service issued (an APNs token in hex, an FCM or Huawei token
   * as given). Sends only when needed: nothing is sent when the stored subscription already
   * matches and is under a day old, so this is cheap to call on every launch. A changed token
   * unsubscribes the old one too.
   *
   * Answers `bool`: true when a request went out and was accepted, false when nothing needed
   * sending. Refused without a network or an account.
   *
   * `force` sends whatever is stored. A reinstall on iOS can keep the database, which lives in the
   * app group, while the push server has dropped the subscription; the stored one then matches
   * and nothing would be sent for up to a day.
   */
  | { type: 'setPushToken'; service: PushService; token: string; force?: boolean }
  /**
   * Removes this device's push subscription, as when somebody switches to slow mode. Answers `ok`
   * once the push server has accepted the removal, or at once when there was none to remove.
   */
  | { type: 'clearPushToken' }
  /**
   * What notifications on this device show. Answers `notificationContent`; `nameAndContent` until
   * somebody chooses. Refused without an account, whose local settings hold it.
   */
  | { type: 'getNotificationContent' }
  /** Stores what notifications on this device show. Answers `ok`. Refused without an account. */
  | { type: 'setNotificationContent'; content: NotificationContent }
  /**
   * The sound iOS notifications on this device play. Answers `notificationSound`; `note` until
   * somebody chooses, and for a stored sound this list does not have. Refused without an account.
   */
  | { type: 'getNotificationSound' }
  /** Stores the sound iOS notifications play. Answers `ok`. Refused without an account. */
  | { type: 'setNotificationSound'; sound: NotificationSound }
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
  /**
   * A page of history: the newest `limit` messages, or with one of `before`, `after` and `around`,
   * the page that one names. Refused with more than one of them, or a `limit` that is not positive.
   *
   * A page is true as of the read. Messages stored later arrive as `messages-added`, and one stored
   * just before the read can be both in the page and announced after it, so a window merges
   * announced messages by id and places them by (timestamp, id).
   */
  | {
      type: 'getMessages'
      conversationId: ConversationId
      limit: number
      /** The page older than this cursor, which is not repeated. */
      before?: MessageCursor
      /** The `limit` messages immediately newer than this cursor, which is not repeated. */
      after?: MessageCursor
      /**
       * A window with this message as near its middle as the history allows: of the rest, half
       * older and half newer, an even limit's spare row newer, and a side that runs out gives what
       * it lacks to the other. The message is in the page unless it is deleted and `includeDeleted`
       * is false; the window is placed by it either way. Refused with `message.not_found` for an
       * id this conversation does not hold.
       */
      around?: number
      includeDeleted: boolean
    }
  /**
   * Stores the message and answers its id; it is then announced like any other. With attachments
   * it is `uploading` until every file is on the file server, and goes on to the ordinary states
   * from there. Refused, storing nothing, when a file is not a readable, non-empty file. Each
   * file's upload reports as an `attachment-progress` of transfer `upload`.
   */
  | {
      type: 'sendMessage'
      conversationId: ConversationId
      body: string
      replyTo?: number
      attachments?: OutgoingAttachment[]
    }
  /**
   * What sending the file at `path` would do with it, under the file server's limit, without
   * sending it: for staging to refuse a file before Send. `contentType` is inferred from the
   * extension when unset, as `sendMessage` infers it. Read on libsession's disk thread.
   */
  | { type: 'attachmentSendPlan'; path: string; contentType?: string }
  /**
   * The most the file server takes in one upload, in encrypted, padded bytes: the limit
   * `attachmentSendPlan` holds a file to, so a file's own size has to be smaller to fit. Belongs to
   * the attached network's file server and changes only with `attachNetwork`; before a network is
   * attached it is libsession's default for the built-in servers.
   */
  | { type: 'getAttachmentUploadLimit' }
  /**
   * Resumes a send that failed, uploading the files not yet up first. Each of those reports as an
   * `attachment-progress` of transfer `upload`, as `sendMessage`'s do.
   */
  | { type: 'retrySend'; messageId: number }
  | { type: 'deleteMessage'; messageId: number; scope: Deletion }
  /**
   * Shows a message as a gallery, or as a list. Answers false, changing nothing, for a message
   * that does not exist or, when `gallery` is true, one that is not `galleryViewable`; turning it
   * off is always allowed. A change is announced as messages-updated; asking for what is already
   * stored answers true and announces nothing. Fetches nothing: getting a gallery's pictures is
   * still the caller's `downloadAttachment`.
   */
  | { type: 'setGallery'; messageId: number; gallery: boolean }
  // Attachments. Nothing here carries bytes: a transfer is reported by `attachment-progress`
  // events, and the file itself is reached by the media scheme each platform resolves natively.
  /**
   * Fetch an attachment into libsession's cache, reporting progress as it goes.
   *
   * One call covers all three cases: it answers at once when the file is already cached, joins a
   * fetch already running - reporting from wherever that has got to - and starts one only when
   * nothing else has. Whether the bytes are here is the attachment's `availability`, not this.
   */
  | { type: 'downloadAttachment'; messageId: number; index: number }
  /**
   * Write an attachment out to a path the person chose, fetching it first if the cache does not
   * hold it. Reads the cache first and fills it as the file arrives, within the cache's size limit,
   * as `downloadAttachment` does.
   */
  | {
      type: 'exportAttachment'
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
  | { type: 'setAttachmentCacheLimit'; limitBytes?: number }
  /**
   * How much disk the cached attachments occupy now, in the limit's measure, so the two can be
   * shown together. 0 when nothing is cached or there is no cache directory.
   */
  | { type: 'getAttachmentCacheSize' }
  | { type: 'getThumbnailEdge' }
  /**
   * The height of the thumbnails made from now on, in device pixels, kept on this device.
   * libsession clamps it to 64 to 1024. Unset forgets the stored value, which puts the edge back to
   * what the app opened the bridge with. Thumbnails already made keep the size they were made at.
   */
  | { type: 'setThumbnailEdge'; edgePx?: number }
  /**
   * How large each of the account's configs is, for an exported log's header, listed by name.
   * Empty before there is an account: the configs are built from it.
   */
  | { type: 'getConfigSizes' }
  /**
   * Every path the network is holding open, with how each is performing and how many requests
   * have gone along it, for the path screen. A snapshot: ask again for a fresher one. Empty under
   * onion requests or with no network attached.
   */
  | { type: 'getNetworkPaths' }
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
  | {
      type: 'deliverTestMessage'
      senderSeedHex: string
      body: string
      timestamp: number
      attachments?: TestAttachment[]
      replyTo?: TestQuote
    }
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
   * A page of history, oldest first whichever page it is: the direction a transcript is read.
   * libsession answers newest first because that is the direction paging runs; the shim reverses.
   *
   * `hasNewer` and `hasOlder` say whether history goes on past the page, counted in the same read
   * as the messages and over the messages the page would show: with `includeDeleted` false, a
   * conversation whose only older messages are deleted has `hasOlder` false. For a page read
   * `before` a cursor `hasNewer` counts from the cursor, and for one read `after`, `hasOlder` does.
   *
   * What each attachment's bytes are doing rides on the attachment itself - `availability`,
   * `fetchDoneBytes`, `fetchTotalBytes` - rather than in a list beside the page. One writer for
   * the first picture and for every correction after it, which is what stops a window drawing an
   * attachment as untouched and then taking it back.
   */
  | { type: 'messagePage'; messages: Message[]; hasNewer: boolean; hasOlder: boolean }
  | { type: 'messageId'; messageId: number }
  | { type: 'hex'; hex: string }
  | { type: 'pref'; value?: string }
  | { type: 'bool'; value: boolean }
  | { type: 'notificationContent'; content: NotificationContent }
  | { type: 'notificationSound'; sound: NotificationSound }
  /**
   * How `closeClient` went. `closed` is false when `reopenClient` cancelled it while it waited.
   * `waitedMs` is how long it waited for outbound work, `closeMs` how long destroying the Client
   * took, `outboundBusy` whether outbound work was still in flight when it did -- a send that will
   * show as interrupted when the Client is back -- and `interrupted` whether the database's SQL had
   * to be interrupted. `interruptedForReopen`: interrupted early, because `reopenClient` came while
   * the Client was being destroyed and the app was in front again.
   */
  | {
      type: 'clientClosed'
      closed: boolean
      waitedMs: number
      closeMs: number
      outboundBusy: boolean
      interrupted: boolean
      interruptedForReopen: boolean
    }
  /** The answer to a seed read once the recovery password is hidden: see `hideRecoveryPassword`. */
  | { type: 'seedHidden' }
  /**
   * Where an export landed, which is not always where it was asked to go: a collision becomes
   * `name (1)`.
   */
  | { type: 'path'; path: string }
  /** Unset only in answer to `getAttachmentCacheLimit`, where it means no limit. */
  | { type: 'byteCount'; bytes?: number }
  | { type: 'sendPlan'; plan: SendPlan }
  /** A thumbnail's height in device pixels, as libsession clamped it. */
  | { type: 'edge'; edgePx: number }
  | { type: 'configSizes'; sizes: ConfigSize[] }
  | { type: 'networkStatus'; status: NetworkStatus }
  | { type: 'networkPaths'; snapshot: NetworkPaths }

export interface Response {
  id: number
  /**
   * libsession reports failures as text - usually SQLite's own message. Deliberately not an
   * enum: the message says which constraint, and inventing codes would throw that away. Set
   * instead of `result`, never beside it.
   */
  error?: string
  /**
   * libsession's dotted code for `error` (`file.not_found`), where libsession gave one. What a
   * caller matches on; `error` is for people. Absent for a refusal the shim makes itself.
   */
  code?: string
  result?: Result
}

/**
 * Change notifications, one per libsession callback, and what `SessionClient.onEvent` delivers.
 *
 * Every one of these carries the whole new state rather than an id to go and fetch. That is what
 * makes a display bindable and applying the same event twice harmless.
 *
 * A conversation's place in its list is the exception: `placement` puts it after another row, so
 * the lists are only right when every event is applied, in the order the stream gives, on top of
 * an answer to `getConversations` and `getMessageRequests` read earlier on the same stream.
 *
 * The shim emits these and the app reads them, with nothing in between rewriting an arm - which
 * is why there is one type rather than a wire one and an app one.
 *
 * `attachment-progress` is the one arm that is not whole state, because a transfer has none to
 * carry: libsession stores nothing about one in flight, and the report is the only record there is.
 */
export type SessionEvent =
  | { type: 'conversation-added'; conversation: Conversation; placement: ListPlacement }
  | { type: 'conversation-updated'; conversation: Conversation; placement: ListPlacement }
  /** `list` is the one the app was last told it is in: `none` when it was never shown in one. */
  | { type: 'conversation-removed'; conversationId: ConversationId; list: ConversationList }
  /**
   * Messages arrived or changed, oldest first.
   *
   * A batch, and **it may span conversations**: one cause routinely reaches several, because a
   * file is one file and fetching or evicting it changes every message showing it, wherever
   * those are. Each `Message` carries its own `conversationId` for that reason.
   *
   * Reported for every message in every conversation rather than whichever one is on screen -
   * there is no notion here of what the app is showing, so deciding what to redraw is the app's.
   * A reply is announced as updated when the message it answers arrives, changes or is deleted,
   * and when what this device holds of one of that message's attachments changes.
   */
  | { type: 'messages-added'; messages: Message[] }
  | { type: 'messages-updated'; messages: Message[] }
  | { type: 'history-replaced'; conversationId: ConversationId }
  /**
   * One report about one attachment transfer, whether a command asked for it or libsession
   * started it on its own.
   *
   * The first report of a transfer is `{doneBytes: 0, totalBytes: 0}` and means it started -
   * `totalBytes` stays 0 until the server says how big the file is. `outcome` absent means still
   * going, and exactly one report per handler carries one: `doneBytes === totalBytes` does not
   * mean finished, because the bytes still have to verify.
   *
   * A download joined by a second request, or by an auto-download, has a handler for each: the
   * joiner first gets one report of where it has got to, and every report after that, the end
   * included, arrives once per handler - identical frames under one key.
   *
   * Reports for one (transfer, messageId, index) are ordered; different ones interleave, and each
   * is rate limited to roughly one per 100ms. A transfer served from the cache reports nothing at
   * all, so an indicator must be driven by time rather than by these arriving.
   *
   * Both count *encrypted* bytes - what is actually being moved - and so do not agree with
   * `Attachment.sizeBytes`, which is the plaintext length.
   *
   * An upload names the message id `sendMessage` answers, and none of a send's reaches the stream
   * before that answer does: the bridge holds any that come first. A file whose upload never
   * started, because one before it failed, gets no report at all. Like a download, an upload's
   * first report is 0 of 0, meaning it has started.
   */
  | {
      type: 'attachment-progress'
      transfer: AttachmentTransfer
      messageId: number
      index: number
      doneBytes: number
      totalBytes: number
      outcome?: AttachmentOutcome
    }
  /**
   * The attached network's status changed. One per change, in the order libsession made them, and
   * never two of the same in a row from libsession itself; the answer to `getNetworkStatus` can
   * repeat the last one, which is harmless because each carries the whole state.
   *
   * A network that goes away reports `disconnected` on the way out, which a discard does. Closing
   * the bridge reports nothing: there is nobody left to tell.
   */
  | { type: 'network-status-changed'; status: NetworkStatus }
  /**
   * libsession's own log lines, forwarded when the bridge was opened with a log level. Worth
   * having because the state machine reports what happened and never why.
   */
  | { type: 'log'; message: string; category: string; level: string }

/** Everything the shim sends back, in the order libsession produced it. */
export type Frame =
  { type: 'response'; response: Response } | { type: 'event'; event: SessionEvent }
