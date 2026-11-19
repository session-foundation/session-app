/**
 * What the app sees of libsession, and what the bridge carries: these are the same types.
 *
 * The C++ shim fills structs generated from this file and the platform layer turns them into
 * JavaScript objects of exactly this shape, so nothing between libsession and a screen converts
 * anything. Timestamps are unix milliseconds, ids are sqlite rowids, sizes are byte counts; all
 * are far inside 2^53, which is why they are plain numbers rather than bigints.
 *
 * Enum values are libsession's own, spelled as strings so a switch reads well.
 */

export type ConversationId = string

export type ConversationKind = 'dm' | 'group' | 'community'

/**
 * Mirrors libsession's own send-state machine, value for value.
 *
 * Complete rather than trimmed to what this bridge can reach: `uploading` and `unsendable` are
 * both about attachments, which nothing here can send yet, but they are libsession's states and
 * the shim's switch over them has to name every one.
 */
export type SendState =
  | 'pending'
  | 'sending'
  | 'sent'
  | 'failed'
  /** Left in flight when the process stopped: libsession's send queue does not survive it. */
  | 'interrupted'
  | 'uploading'
  | 'unsendable'

export type Deletion = 'here' | 'everywhere'

/**
 * What a conversation fetches without being asked.
 *
 * Device-local and never synced: auto-downloading everything on a desktop and nothing on a phone
 * is the case it exists for.
 */
export type AutoDownload = 'none' | 'image-attachments' | 'all'

/**
 * What sending a file as an attachment will do with it, decided from its header alone as the send
 * decides it: libsession's `image::SendPlan`.
 *
 * - `reencoded`: a picture libsession decodes, sent re-encoded and shrunk to fit. Only the send
 *   tells whether its pixels decode and whether it then fits; it is refused there if not.
 * - `as-is`: not a picture, and not labelled one, within the file server's limit.
 * - `original-cannot-decode`: sent as it is, flagged as the original file: a picture this build
 *   does not decode (HEIC off Apple), or a file labelled a picture that is not one libvips reads.
 * - `original-animated-png`: sent as it is, flagged as the original file, since re-encoding would
 *   keep only its first frame.
 * - `too-large-to-decode`: refused, a picture past the decode limits.
 * - `too-large-for-server`: refused, over the file server's limit and not shrinkable.
 * - `unreadable`: refused, a picture whose header is damaged.
 * - `missing`: refused, no regular file at the path.
 */
export type SendPlan =
  | 'reencoded'
  | 'as-is'
  | 'original-cannot-decode'
  | 'original-animated-png'
  | 'too-large-to-decode'
  | 'too-large-for-server'
  | 'unreadable'
  | 'missing'

/**
 * Which request a progress report belongs to.
 *
 * libsession fetches a file once for every download and export of it, but reports to each request
 * separately and ends each with its own outcome, so one attachment can be downloading and exporting
 * at once. An export of a file over libsession's `requested_cache_max_size` runs a transfer of its
 * own that nothing joins; the bridge leaves that size unset.
 *
 * `upload` is a file of a message of ours going to the file server, reported for `sendMessage`
 * and `retrySend` alike. libsession uploads a message's files one at a time in index order, and
 * only those not yet up: a retry reports nothing for a file an earlier attempt finished. An upload
 * that fails ends the message's attempt, so the files after it report nothing at all.
 */
export type AttachmentTransfer = 'download' | 'export' | 'upload'

/**
 * Whether an attachment's bytes are here, on their way, or neither.
 *
 * What it is for is deciding what to *draw*: the file, a progress indicator, or something to
 * press. It arrives **on the message** rather than being asked for separately, which is what
 * makes a display that missed the reports correct without a second query.
 *
 * A hint about what the next call will do rather than a promise about the file: a `cached` that
 * is evicted before anybody asks only means the fetch reads the network instead of the disk.
 *
 * Reported for an outgoing attachment as for an incoming one - what we send is kept under the
 * rule that would have fetched it - so "can this be drawn without a download" has one answer
 * regardless of direction.
 */
export type AttachmentAvailability =
  | 'cached'
  | 'fetching'
  | 'absent'
  /**
   * The file server does not hold the file, which is usually an upload that has expired. The fix
   * is the sender's: the same file re-sent lands at the same url, so a resend turns this back into
   * `absent` for every message quoting it. Offer "ask them to send it again", not a retry button.
   */
  | 'notFound'
  /**
   * It arrived and could not be read as this message described it. A resend reproduces the same
   * bytes and the same failure, so retrying is not the advice. A verdict on this message's key and
   * size rather than on the file: another message naming the same url may read it perfectly well.
   */
  | 'unreadable'

/**
 * Why an attachment operation failed, as libsession's own stable code: a transfer's `outcome`, or
 * a refused command's `code`.
 *
 * **Open, not a union**: libsession adds codes without it being a breaking change, so anything
 * matching on these needs a default branch rather than an exhaustive switch.
 */
export type AttachmentError = string

/** No message has this id. */
export const MESSAGE_NOT_FOUND: AttachmentError = 'message.not_found'
/** The message exists and has no attachment at this index. */
export const ATTACHMENT_NOT_FOUND: AttachmentError = 'attachment.not_found'
/**
 * The file was gone from the path it was attached from before libsession had its own copy. Reported
 * on an upload, never a fetch, and leaves the message `unsendable`.
 */
export const ATTACHMENT_FILE_MISSING: AttachmentError = 'attachment.file_missing'
/**
 * Too large to send: a picture too large for the file server even re-encoded at libsession's
 * smallest sendable edge, a file sent as it is or as its original that does not fit the file
 * server's limit, or a picture too large to decode. Reported on an upload, and leaves the message
 * `unsendable`: a retry would fail the same way.
 */
export const ATTACHMENT_TOO_LARGE: AttachmentError = 'attachment.too_large'
/**
 * A picture that could not be read or re-encoded for sending. Reported on an upload, and leaves
 * the message `failed`, since a retry reads the file again.
 */
export const ATTACHMENT_UNREADABLE: AttachmentError = 'attachment.unreadable'
/** The file server does not hold it. The sender's to repair by sending it again. */
export const FILE_NOT_FOUND: AttachmentError = 'file.not_found'
/** It arrived but could not be turned back into the file it claims to be. Not worth retrying. */
export const FILE_UNREADABLE: AttachmentError = 'file.unreadable'
/** This attempt failed for a reason that may not recur, so retrying is reasonable. */
export const FILE_DOWNLOAD_FAILED: AttachmentError = 'file.download_failed'
/** The request was withdrawn, or the attachment was deleted while it was being fetched. */
export const FILE_DOWNLOAD_CANCELLED: AttachmentError = 'file.download_cancelled'
/** An export could not be written to its destination. */
export const FILE_SAVE_FAILED: AttachmentError = 'file.save_failed'

/**
 * How a transfer ended, on the one report that ends it.
 *
 * Two fields rather than a code with a success value, because "it worked" and "here is which of
 * several ways it failed" are different questions and only one of them has an answer to match on.
 */
export interface AttachmentOutcome {
  /** The bytes arrived and verified; for an upload, the file server accepted the file. */
  ok: boolean
  /** Why it failed. Unset when `ok`. */
  error?: AttachmentError
}

/**
 * An attachment on a stored message, in either direction.
 *
 * Whether the bytes are on this device is `availability`. Asking for them is a download, which the
 * conversation's auto-download setting may have said no to.
 */
export interface Attachment {
  /** Position in the message's list, and what every attachment call takes. */
  index: number
  /** The sender's claim on an incoming attachment: a display hint, not a fact about the bytes. */
  contentType?: string
  filename?: string
  /**
   * The file's size before encryption. Unset on an outgoing attachment that has not uploaded, and
   * the sender's claim on an incoming one. Not comparable with a progress report's `totalBytes`,
   * which counts encrypted bytes.
   */
  sizeBytes?: number
  voiceMessage: boolean
  /** Supplied by whoever attached the file - libsession does not measure images. */
  width?: number
  height?: number
  /**
   * Whether the sender supplied a ThumbHash, which is something to draw in the picture's place
   * until its bytes arrive. False when the sender supplied none.
   *
   * A flag rather than the pixels: a placeholder is an image, and an image is resolved through the
   * media port like any other rather than riding the frame stream. What it names is the second
   * path on that scheme.
   */
  hasThumbhash: boolean
  /**
   * The ThumbHash's rough record of the picture's shape, width over height: libsession's
   * `component_aspect_ratio`, the ratio of the hash's DCT component counts, which its encoder picks
   * in proportion to the source. Set exactly when `hasThumbhash` is.
   *
   * Coarse by construction. It is one of 7/n or n/7 for n in 1 to 7 (5/n or n/5 for a hash with
   * alpha), and saturates there: a 4:3 photo reads 7:5, and every picture wider than 7:1 reads 7.
   * A last resort for laying a picture out where the sender gave no `width` and `height`, and
   * never a reason to override them.
   *
   * libsession's header says it is not the picture's aspect ratio and must never be used to lay one
   * out. Here it shapes only a tile with nothing else to go on, and only until the thumbnail lands,
   * whose shape `albumAspect` takes instead: the tile moves at most once.
   */
  thumbhashAspect?: number
  /**
   * Whether libsession holds a thumbnail of this attachment: a JPEG of the picture in its own
   * shape, cropped to its centre at 21:9 when it is wider than that either way up, then the
   * client's thumbnail edge tall and never enlarged. An album's tile takes its shape, within the
   * same 9:21 to 21:9; a list's square thumbnail covers it and crops. Made of a displayable image
   * whose bytes are cached, and after them, so it turns true in a later `messages-updated` than the
   * one reporting `cached`; false again once the cache evicts the file, which takes the thumbnail
   * too. One we send has it sooner: made from libsession's own copy before the upload, and true
   * from then on until the cached file is evicted.
   *
   * What a tile draws, through the media scheme's `thumbnail` path; a viewer draws the file.
   */
  hasThumbnail: boolean
  /**
   * The thumbnail's size, read from the JPEG libsession made, so a layout can shape a tile before
   * loading it. Both 0 while `hasThumbnail` is false.
   */
  thumbnailWidthPx: number
  thumbnailHeightPx: number
  /**
   * Whether libsession holds a rendition of this attachment: the whole picture as a JPEG or WebP
   * (animated WebP for an animation) within the rendition edge (2048 px on a side unless set).
   * It is re-encoded without metadata, or is the original itself when that is already an upright
   * JPEG or WebP within the edge, metadata included. Made only once asked for: the first
   * `fetchRendition` of a picture with none queues it and is refused, and this turns true by
   * update when it is made. Kept, evicted and reported as `hasThumbnail` is.
   *
   * What a viewer draws, through the media scheme's `rendition` path; export still writes the file.
   */
  hasRendition: boolean
  /**
   * libsession will make no rendition of this picture: past its pixel limits, a header it cannot
   * read, or a re-encode that failed. Settled once it has read the cached file, so only ever true
   * while `availability` is `cached`, and never together with `hasRendition`. Asking again does
   * nothing until a libsession that decodes more replaces this one.
   */
  renditionRefused: boolean
  /**
   * The sender sent the file exactly as it was, metadata included. Offered only as a file to
   * export, never opened in the viewer, though its thumbnail is still drawn.
   */
  originalFile: boolean
  /**
   * On the file server: an outgoing attachment's upload finished, and always true for an incoming
   * one. Deliberately not "the bytes are here": libsession records where it reads a file to send
   * from but exposes no path, because the application chose it and knows it.
   */
  uploaded: boolean
  /** Whether the bytes are here, coming, or neither. See `AttachmentAvailability`. */
  availability: AttachmentAvailability
  /**
   * How far the transfer has got while `availability` is `fetching`, and 0 otherwise.
   *
   * The same encrypted-byte figures `attachment-progress` carries, so a bar drawn from these and
   * then fed by reports continues rather than jumping. `fetchTotalBytes` is 0 until the server has
   * said how big the file is. What they are for is a conversation opened while a download is
   * already running: the reports went to whoever started it.
   */
  fetchDoneBytes: number
  fetchTotalBytes: number
  /**
   * When the recipient last saved it - us on an incoming attachment, the other party on one we
   * sent. Unset means *not known to have been saved*, which is not the same as not saved: it
   * depends on the other end volunteering a notification.
   */
  savedAtMs?: number
}

/**
 * A file to send with a message. Sending files needs `cacheDir`.
 *
 * Without `takeFile`, libsession copies it beneath the cache directory once the message is stored,
 * off the calling thread, and reads only that copy from then on: `path` may change or go once the
 * attachment reads `cached`. Until it uploads, `fetchMedia` and `exportAttachment` serve the copy.
 * A picture libsession decodes is sent re-encoded to fit the file server, and the stored
 * attachment then describes what was sent.
 */
export interface OutgoingAttachment {
  path: string
  /** Inferred from the filename's extension when unset. */
  contentType?: string
  /** What the recipient sees it called; `path`'s own filename when unset. */
  filename?: string
  /**
   * Hands the file to libsession instead of having it copied, refusing a symbolic link. Only for a
   * copy the app made: once the message is stored the file is gone from `path`, and a send
   * that was refused leaves it there.
   *
   * It is hard-linked under the cache directory, or copied where it cannot be, on the calling
   * thread during the send, so a large copy holds that call up. It waits there unencrypted.
   *
   * Until it uploads, the attachment is `cached`, and `fetchMedia` and `exportAttachment` serve it
   * from that copy; `absent` if the copy has gone. libsession deletes it once it has uploaded, or
   * its message is unsendable or deleted.
   */
  takeFile?: boolean
}

/**
 * One attachment, by its message and its place in that message's list.
 *
 * For TypeScript signatures only: the protocol spells the two fields out on each command, because
 * the generator takes a union member only as an object literal.
 */
export type AttachmentRef = { messageId: number; index: number }
export type WithAttachmentRef = { ref: AttachmentRef }

/**
 * How far a transfer has got, in encrypted bytes, so not comparable with `Attachment.sizeBytes`.
 * `totalBytes` is 0 until the server has said how big the file is.
 */
export type TransferProgress = { doneBytes: number; totalBytes: number }

/** Omitted, libsession notifies the sender and writes `name (1)` rather than overwrite. */
export type ExportAttachmentOptions = {
  notifySender?: boolean | undefined
  replace?: boolean | undefined
}

export type PixelSize = { width: number; height: number }

/**
 * One of the account's configs and how large it is: the size of the dump it would write now.
 * For diagnostics - the header of an exported log - and nothing else.
 */
export interface ConfigSize {
  /** `user_profile`, `contacts`, `convo_info_volatile`, `user_groups` or `local`. */
  name: string
  bytes: number
}

/**
 * Where a page of history starts. Newest-first, keyed by (timestamp, id) so that a page seam
 * cannot duplicate or skip a message that shares a timestamp with its neighbour.
 */
export interface MessageCursor {
  timestamp: number
  id: number
}

/**
 * The message a reply answers, as this device stores it: never the sender's snippet of it.
 *
 * It carries no reply of its own. libsession loads one level, so a reply to a reply shows its own
 * parent and not the chain.
 */
export interface QuotedMessage {
  id: number
  outgoing: boolean
  /** Empty once deleted, as `attachments` is. */
  body: string
  /** Each addressed by this message's `id` and its own `index`, as any attachment is. */
  attachments: Attachment[]
  deleted?: Deletion
}

/**
 * What a message is a reply to. The wire names a message by who sent it and when, so `author` and
 * `timestamp` are always known, even when the message is not here.
 *
 * Not to be cached beside the message: the reply is announced again as `messages-updated` when
 * its original arrives, changes, is deleted, or when what this device holds of one of the
 * original's attachments changes.
 */
export interface Reply {
  author: string
  timestamp: number
  /** Unset means this device does not have the original. */
  messageId?: number
  /** Set exactly when `messageId` is; a deleted original is still here, with `deleted` set. */
  message?: QuotedMessage
}

export interface Message {
  id: number
  conversationId: ConversationId
  author: string
  timestamp: number
  body: string
  outgoing: boolean
  /**
   * Delivery to the recipient - what "did it arrive" means, and what a transcript shows.
   *
   * Incoming messages have no send state of their own and report `sent`; every consumer reads
   * this behind `outgoing`, so an absent value would only move the question.
   */
  sendState: SendState
  /**
   * Delivery of the copy deposited in our own swarm, which is how our other devices come to see
   * a message we sent. A separate send, retried separately, so it can still be pending when the
   * recipient already has the message - which is why it is not what a transcript shows.
   *
   * Unset where there was no such send to report: an incoming message, and a note to self, whose
   * recipient swarm is our own and whose `sendState` already covers the only send there was.
   * Optional rather than defaulted, because `sent` here would claim a sync that never happened.
   */
  syncState?: SendState
  attachments: Attachment[]
  /**
   * libsession's answer to whether this message's attachments could be shown as pictures rather
   * than listed as files: "has attachments, and every one is a type libsession displays as an
   * image" (JPEG, PNG, WebP, GIF, AVIF, `image/pjpeg`, case-insensitive). It does not say whether
   * this client can draw them, which is the screens' decision to make.
   */
  galleryViewable: boolean
  /**
   * Whether this message is shown as a gallery: libsession's decision, stored on this device only
   * and changed by `setGallery`. On by default for a `galleryViewable` message stored by this
   * libsession; a database from earlier builds may hold such sets stored as lists. Never true when
   * `galleryViewable` is false. A client that cannot draw every attachment as a picture shows a
   * list regardless and leaves this alone.
   */
  gallery: boolean
  replyTo?: Reply
  deleted?: Deletion
}

/** A flattened AnyConversation: the fields every kind has, plus the DM-only ones. */
export interface Conversation {
  id: ConversationId
  kind: ConversationKind
  /** Empty until the other side's profile has arrived; callers fall back to the id. */
  displayName: string
  nickname?: string
  lastActivity: number
  priority: number
  /**
   * A count on the conversation, never a flag on a message: libsession has no per-message unread.
   */
  unreadCount: number
  markedUnread: boolean
  snippet?: string
  muteUntil?: number
  /**
   * Unset means nobody has been asked yet, which is not the same as having been asked and said no:
   * Session asks once per conversation and remembers the answer, and only the former should prompt
   * again. Setting it - `none` included - is what records that the question was asked.
   */
  autoDownload?: AutoDownload
  request: boolean
  awaitingApproval: boolean
  noteToSelf: boolean
  blocked: boolean
}

/**
 * Which of the two lists a conversation sits in.
 *
 * `none` is an answer rather than a missing one: a hidden conversation is in neither list, and so
 * is one the app has not been shown.
 */
export type ConversationList = 'none' | 'conversations' | 'requests'

/**
 * Where a conversation was, and where it belongs now: enough to apply without consulting
 * anything, because the order is libsession's and the two lists are not sorted alike.
 *
 * Each one places a row next to another, so they hold only when applied in the order given and
 * none is skipped.
 */
export interface ListPlacement {
  /**
   * The list the app was last told this row is in, which is the one to take it out of. `none`
   * when it was told of none: a row it has not been shown, or one that was hidden.
   */
  from: ConversationList
  /** Where it belongs now. `none` means neither list, which is what hiding does. */
  to: ConversationList
  /** The row it now follows in `to`; unset means first. Always unset when `to` is `none`. */
  after?: ConversationId
}

export interface AccountInfo {
  haveAccount: boolean
  sessionId?: string
  displayName?: string
  networkAttached: boolean
}

/**
 * Whether the attached network can carry traffic: libsession's `ConnectionStatus`, as
 * `Network::on_status_changed` reports it.
 *
 * `connected` means both the transport and the router are up -- a path exists -- which is the
 * readiness `AccountInfo.networkAttached` does not say: that one turns true when a network is
 * attached, before anything has been reached through it. `disconnected` covers both a network
 * that lost its connections and no network at all: none attached yet, a client opened to stay
 * offline, or one torn down by a discard. `unknown` is libsession's state before either layer has
 * reported, and also its answer when the two disagree in a way it cannot name.
 */
export type NetworkStatus = 'unknown' | 'connecting' | 'connected' | 'disconnected'

/**
 * What a path leads to. `ownSwarm` is the storage node the account's subscription is held with;
 * `storageNode` is any other, which is a group's swarm, a contact's a message was sent to, or a
 * proxy a community request went through; `fileServer` is the file server, which is reached as a
 * client behind a relay of its own choosing rather than as a node on the network.
 *
 * Under onion requests a path is built before any destination is chosen and carries requests to
 * all of them: `anyFile` is one of those kept for file transfers, `anyNode` one for everything
 * else.
 */
export type PathDestination = 'ownSwarm' | 'storageNode' | 'fileServer' | 'anyNode' | 'anyFile'

/** One relay of a path, as the path screen shows it. */
export interface PathHop {
  /** The relay's Ed25519 public key, hex: what identifies it from one snapshot to the next. */
  pubkeyHex: string
  /**
   * The ISO 3166-1 alpha-2 code of the country its address is registered in, from the IP table
   * libsession bundles. Absent when the address is not in the table, or the build carries none.
   */
  country?: string
}

/**
 * A path the client is holding open. Every figure covers the whole path, out and back: the router
 * does not time individual hops.
 */
export interface NetworkPath {
  /**
   * Who the path's session is with, hex. Stays the same when the path itself is replaced. For an
   * `anyNode` or `anyFile` path, which has no one remote, the router's name for the path instead:
   * a replacement has a new one.
   */
  remoteHex: string
  destination: PathDestination
  /**
   * A spare the router holds ready for the same remote and sends nothing along. Each remote has
   * one path that is not, and that one carries the request counts; a standby path's are zero.
   */
  standby: boolean
  /**
   * The hops, nearest first. To a storage node there are four and the last is the node itself; to
   * the file server there are three and the last is the relay it is reached through; an `anyNode`
   * or `anyFile` path has three, the last a relay that forwards to whatever each request names.
   */
  hops: PathHop[]
  /**
   * Mean round trip of the router's pings along it. Zero until the first one is answered. Onion
   * requests send no pings, so an `anyNode` path's is its requests' round trips, which include the
   * destination's time to answer; an `anyFile` path's is always zero, since a file transfer's round
   * trip times the file as much as the path.
   */
  latencyMs: number
  /**
   * Mean difference between consecutive pings' round trips. Always zero on an `anyNode` or
   * `anyFile` path: requests differ too much in kind and size to measure it by.
   */
  jitterMs: number
  /**
   * Requests sent to `remoteHex` since the network started, and how many of them were passed on
   * to a server outside the network (a community, or the file server's web interface). Totals, so
   * that two snapshots tell how many went in between; they carry over when the path is replaced,
   * except on an `anyNode` or `anyFile` path, whose counts are its own.
   */
  requestsSent: number
  proxiedRequestsSent: number
  /**
   * How long ago the last of `requestsSent` went, so one snapshot tells which paths are in use.
   * Absent on a standby path and for a remote nothing has been sent to.
   */
  msSinceLastRequest?: number
  /**
   * The router's pings answered along it since it was built. A total that starts again from zero
   * when the path is replaced, which a change in `hops` tells. Always zero under onion requests.
   */
  pingsAnswered: number
}

/** How many service nodes one country holds. */
export interface CountryNodes {
  /** The ISO 3166-1 alpha-2 code, from the same IP table as a hop's `country`. */
  country: string
  nodes: number
}

/** Every path the client is holding open, for the path screen. */
export interface NetworkPaths {
  /** In no particular order. Empty with no network, or one that sends without paths. */
  paths: NetworkPath[]
  /**
   * How many service nodes each country holds, most first, from the node cache: the network as
   * this client knows it, which changes over hours rather than between snapshots. Nodes the table
   * cannot place are left out. Empty until the cache is first fetched, with no network, or in a
   * build without the country table.
   */
  nodesByCountry: CountryNodes[]
  /**
   * The credit the country table's licence requires wherever its results are shown, or empty when
   * the build carries no table.
   */
  countryAttribution: string
}
