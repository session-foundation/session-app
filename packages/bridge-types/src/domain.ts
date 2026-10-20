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
 * Which request a progress report belongs to.
 *
 * libsession fetches a file once for every download and export of it, but reports to each request
 * separately and ends each with its own outcome, so one attachment can be downloading and exporting
 * at once. An export of a file over libsession's `requested_cache_max_size` runs a transfer of its
 * own that nothing joins; the bridge leaves that size unset.
 */
export type AttachmentTransfer = 'download' | 'export'

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
/** The file is no longer at the path it was attached from. Reported on an upload, never a fetch. */
export const ATTACHMENT_FILE_MISSING: AttachmentError = 'attachment.file_missing'
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
  /** The bytes arrived and verified. */
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
  hasPreview: boolean
  /**
   * On the file server: an outgoing attachment's upload finished, and always true for an incoming
   * one. Deliberately not "the bytes are here" - libsession records no local path, because the
   * application chose it and a stored copy would go stale the moment the file moved.
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
 * The message a reply points at, resolved one level deep only: a reply to a reply shows its own
 * parent, not the whole chain, so `body` is absent on a nested reply even when `messageId` is set.
 */
export interface Reply {
  author: string
  timestamp: number
  messageId?: number
  body?: string
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
   * than listed as files: "has attachments, and every one is `image/*`". It does not say whether
   * this client can draw them, which is the screens' decision to make.
   */
  galleryViewable: boolean
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

export interface AccountInfo {
  haveAccount: boolean
  sessionId?: string
  displayName?: string
  networkAttached: boolean
}
