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
  AttachmentRef,
  AutoDownload,
  ConfigSize,
  Conversation,
  ConversationId,
  Deletion,
  ExportAttachmentOptions,
  FileServerConfig,
  Frame,
  Message,
  MessageCursor,
  NetworkPaths,
  NetworkStatus,
  OutgoingAttachment,
  PixelSize,
  NotificationContent,
  NotificationSound,
  PushService,
  Request,
  RouterKind,
  SeedNode,
  SendPlan,
  SessionEvent,
} from '@session/bridge-types'

export type Unsubscribe = () => void

/** How `closeClient` went: see the `clientClosed` result in the protocol. */
export interface ClientClosed {
  /** False when `reopenClient` cancelled the close while it waited. */
  closed: boolean
  waitedMs: number
  closeMs: number
  /** Outbound work still in flight when the Client went: it comes back interrupted. */
  outboundBusy: boolean
  /** Whether the database's SQL had to be interrupted for the Client to go in time. */
  interrupted: boolean
  /** Interrupted early, because the app came back while the Client was being destroyed. */
  interruptedForReopen: boolean
}

/** Everything a network needs, so that attaching one is a single decision. */
export interface NetworkAttachment {
  netid: string
  /** Required for devnet, which libsession has no seeds of its own for. */
  seedNodes?: SeedNode[]
  fileServer?: FileServerConfig
  /** Defaults to session-router on mainnet and testnet, onion requests on devnet. */
  router?: RouterKind
}

/**
 * A page of history, oldest first, and whether history goes on past it either way, as of the read.
 * See the protocol's `messagePage` for what the flags count.
 */
export type MessagePage = { messages: Message[]; hasNewer: boolean; hasOlder: boolean }

/** Which page `getMessages` reads: the newest, or the one that one of the three positions names. */
export type MessagePageOptions = {
  limit?: number | undefined
  /** The page older than this cursor, which is not repeated. */
  before?: MessageCursor | undefined
  /** The page immediately newer than this cursor, which is not repeated. */
  after?: MessageCursor | undefined
  /** A window with this message, by id, as near its middle as the history allows. */
  around?: number | undefined
  includeDeleted?: boolean | undefined
}

export interface OutgoingMessage {
  body: string
  replyTo?: number
  /** In the order the recipient sees them. */
  attachments?: OutgoingAttachment[] | undefined
}

export interface SessionClient {
  /** Events arrive in the order libsession produced them, responses interleaved in place. */
  onEvent(listener: (event: SessionEvent) => void): Unsubscribe

  getAccountInfo(): Promise<AccountInfo>
  createAccount(): Promise<void>
  restoreAccount(from: { words: string[]; language?: string } | { hexSeed: string }): Promise<void>
  /**
   * Whether a phrase would restore, without restoring it.
   *
   * Rejects the way `restoreAccount` would - same decode, same errors - so onboarding can say a
   * phrase is wrong at the screen that asked for it, and still mint nothing until the end.
   */
  checkRecoveryPhrase(words: string[], language?: string): Promise<void>
  /**
   * Throws the account away and starts from nothing: onboarding's undo.
   *
   * The database goes, so the identity, the configs fetched under it and the history go with it.
   * Not a logout -- there is nothing to log back in to, and the caller is expected to be showing
   * the first screen afterwards.
   */
  discardAccount(): Promise<void>
  /**
   * Says the account is here to stay.
   *
   * Until this is called the account is provisional, and a start that finds an unconfirmed one
   * throws it away — so this is what turns "an account was made" into "an account was kept".
   */
  keepAccount(): Promise<void>
  /**
   * The recovery password's words; libsession owns the word list, so onboarding needs no mnemonic
   * library of its own. Null once the recovery password is hidden (`hideRecoveryPassword`).
   */
  getSeedMnemonic(language?: string): Promise<string[] | null>
  /**
   * The seed as lowercase hex, for a recovery password's QR code: 16 bytes when that is the whole
   * seed, as for every account the 13 words describe, and 32 otherwise. `restoreAccount` takes
   * either length back. Null once the recovery password is hidden.
   */
  getSeedHex(): Promise<string | null>
  /**
   * Hides the recovery password on this device for good: both seed reads answer null from then on.
   * Resolves once it is stored.
   */
  hideRecoveryPassword(): Promise<void>
  /** Whether the recovery password has been hidden on this device. */
  getRecoveryPasswordHidden(): Promise<boolean>
  setDisplayName(name: string): Promise<void>
  /**
   * Attach a network, or replace the one attached. Refused whole: a network that will not build
   * leaves the client on whatever it had.
   */
  attachNetwork(config: NetworkAttachment): Promise<void>
  /** One poll cycle, run to completion - what every OS background budget wants. */
  pollOnce(): Promise<void>
  /**
   * Fill the service-node cache before there is an account, so the first attach is not also the
   * first refresh. Warms the network given at init, since a cache warmed for another is one the
   * attach cannot use.
   *
   * True when the pool has nodes. False where there is nothing to warm or nothing to gain: no
   * network configured, an account already there to use one, or a warm already running.
   */
  warmNetworkCache(): Promise<boolean>
  /**
   * Whether the attached network can carry traffic now: `disconnected` with none attached. Each
   * change after this arrives as `network-status-changed`.
   */
  getNetworkStatus(): Promise<NetworkStatus>
  /**
   * How often libsession polls the swarm. Its default of 20 seconds is about right for a
   * person and far too long for a test; a positive number of milliseconds is the only valid
   * argument.
   */
  setPollInterval(intervalMs: number): Promise<void>
  /**
   * Closes the database before the OS suspends the process, once nothing is outbound or after
   * `waitMs`, interrupting its SQL `interruptMs` in if the Client is still not gone. While it
   * waits the client works as before and `reopenClient` cancels it; once closed, every request but
   * `reopenClient` is refused. For iOS: see `closeClient` in the protocol.
   */
  closeClient(waitMs: number, interruptMs: number): Promise<ClientClosed>
  /** Cancels a waiting `closeClient`, or builds the Client again once it has closed. */
  reopenClient(): Promise<void>
  /**
   * Subscribes this device to pushes through `service` with the token it issued, or renews the
   * subscription. True when a request went out, false when the stored one already matched and was
   * recent. With `force`, sent whatever is stored. Refused without a network or an account. See
   * `setPushToken` in the protocol.
   */
  setPushToken(service: PushService, token: string, force?: boolean): Promise<boolean>
  /** Removes this device's push subscription, if it has one. */
  clearPushToken(): Promise<void>
  /**
   * What notifications on this device show; `nameAndContent` until somebody chooses. Refused
   * without an account.
   */
  getNotificationContent(): Promise<NotificationContent>
  /** Stores what notifications on this device show. Refused without an account. */
  setNotificationContent(content: NotificationContent): Promise<void>
  /**
   * The sound iOS notifications on this device play; `note` until somebody chooses. Refused without
   * an account.
   */
  getNotificationSound(): Promise<NotificationSound>
  /** Stores the sound iOS notifications play. Refused without an account. */
  setNotificationSound(sound: NotificationSound): Promise<void>
  /** The person's word for themselves, which a mention of them becomes in a notification. */
  setNotificationYou(you: string): Promise<void>

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
   * A page of history, oldest first.
   *
   * What each attachment's bytes are doing rides on the attachment - `availability`,
   * `fetchDoneBytes`, `fetchTotalBytes` - so a window built from this page is already correct
   * rather than drawing every attachment as untouched and then taking it back.
   *
   * True as of the read: a message stored later arrives as `messages-added`, and one stored just
   * before can be in the page and announced after it, so a window merges by id and places by
   * (timestamp, id). Rejects with `MESSAGE_NOT_FOUND` for an `around` this conversation lacks.
   */
  getMessages(id: ConversationId, options?: MessagePageOptions): Promise<MessagePage>
  /**
   * Resolves as soon as libsession has stored the row, which is before it is sent. The states
   * that follow arrive as message-updated, and each file's upload as attachment-progress of
   * transfer `upload`, none of them before this resolves.
   */
  sendMessage(id: ConversationId, message: OutgoingMessage): Promise<number>
  /**
   * Resumes a send that failed, and answers whether there was anything left to resume. The files
   * it uploads report as `sendMessage`'s do.
   */
  retrySend(messageId: number): Promise<boolean>
  /**
   * Stores, on this device, whether a message is shown as a gallery, announced as messages-updated
   * when it changes. False, changing nothing, for a missing message or for a gallery its
   * `galleryViewable` refuses.
   */
  setGallery(messageId: number, gallery: boolean): Promise<boolean>
  deleteMessage(messageId: number, scope: Deletion): Promise<void>

  /**
   * Fetch an attachment into libsession's cache, reporting progress as `attachment-progress`
   * events. A cached file resolves at once and reports nothing, and a fetch already running is
   * joined rather than duplicated. Whether the bytes are here is the attachment's `availability`.
   */
  downloadAttachment(messageId: number, index: number): Promise<void>
  /**
   * Writes an attachment out to a path the person chose, and resolves with where the file actually
   * landed: a name collision becomes `name (1)`.
   */
  exportAttachment(
    messageId: number,
    index: number,
    destination: string,
    options?: ExportAttachmentOptions,
  ): Promise<string>
  /**
   * What sending the file at `path` would do with it, decided from its header as the send decides
   * it, under the file server's limit. `contentType` is inferred from the extension when unset.
   * Answers `missing` rather than failing for a path with no file.
   */
  attachmentSendPlan(path: string, contentType?: string): Promise<SendPlan>
  /**
   * The most the file server takes in one upload, counted encrypted and padded, so a file must be
   * somewhat smaller to fit. Changes only with `attachNetwork`.
   */
  getAttachmentUploadLimit(): Promise<number>
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
  setAttachmentCacheLimit(limitBytes?: number): Promise<void>
  /** How much disk the cached attachments occupy now, measured as the limit is. */
  getAttachmentCacheSize(): Promise<number>
  /**
   * The height of the thumbnails libsession makes, in device pixels, clamped to 64 to 1024.
   * Kept on this device, and undefined forgets it, back to the edge the bridge was opened with.
   * Thumbnails already made keep the size they were made at.
   */
  getThumbnailEdge(): Promise<number>
  setThumbnailEdge(edgePx?: number): Promise<void>
  /** Each config and the size of its dump, for an exported log's header; empty with no account. */
  getConfigSizes(): Promise<ConfigSize[]>
  /**
   * Every path the network holds open, with each one's round trip and request totals, for the
   * path screen. A snapshot to poll while the screen is open; empty without a connected network
   * or under onion requests.
   */
  getNetworkPaths(): Promise<NetworkPaths>

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

/** An attachment's bytes, decrypted, for whatever draws them. */
export interface AttachmentMedia {
  contentType: string
  bytes: Uint8Array
}

/**
 * How a loader is to draw an original or a rendition, from its header alone: the shim's
 * `decode_plan`, which Android applies and desktop main serves by.
 */
export interface DecodePlan {
  /** The longest edge to decode at, or 0 to decode it whole. */
  edgePx: number
  /** Whether to draw it still, as its first frame: anything past the budget. */
  firstFrameOnly: boolean
  /** Whether it is a GIF or PNG too large for a decoder that holds those whole to decode at all. */
  exceedsWholeDecodeCeiling: boolean
  /** Whether its size was read; one that was not is planned as the largest square, still. */
  measured: boolean
}

/** What desktop main asks before it hands Chromium an original, which no `<img>` can bound. */
export interface DecodePlanner {
  planDecode(bytes: Uint8Array): DecodePlan
}

/**
 * A decoded ThumbHash: RGBA8, row-major, not alpha-premultiplied, `width * height * 4` long.
 *
 * Raw pixels rather than an encoded image, because the bridge is not the right place to pick a
 * format. Whatever serves the media scheme hands them to its platform's image pipeline.
 */
export type AttachmentThumbhash = PixelSize & { rgba: Uint8Array }

/**
 * What answers a media URL: the addon, the Nitro bridge, or the fake.
 *
 * Beside the transport rather than on it, because the frame stream carries state and its ordering
 * is what makes a display bindable: a multi-megabyte file on it would stall every state frame
 * behind a payload nothing can contradict.
 */
export interface MediaSource {
  /** From libsession's cache only, never a download: refused while the file is not cached. */
  fetchMedia(ref: AttachmentRef): Promise<AttachmentMedia>
  fetchThumbhash(ref: AttachmentRef): Promise<AttachmentThumbhash>
  /**
   * The attachment's thumbnail, a JPEG, made locally by libsession: never a download. Refused
   * while `Attachment.hasThumbnail` is false.
   */
  fetchThumbnail(ref: AttachmentRef): Promise<Uint8Array>
  /**
   * The attachment's rendition, from libsession's cache only: never a download. Typed by what the
   * bytes are, `image/jpeg` or `image/webp`. Refused while `Attachment.hasRendition` is false.
   */
  fetchRendition(ref: AttachmentRef): Promise<AttachmentMedia>
  /**
   * libsession's thumbnail of a local file staged to send, a JPEG at the edge it will make the sent
   * file's at. Refused for a path `isStagedPath` refuses, a file that cannot be read, and anything
   * that is not a picture.
   */
  fetchStagedThumbnail(path: string): Promise<Uint8Array>
}
