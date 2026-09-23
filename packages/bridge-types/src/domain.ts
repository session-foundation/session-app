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
 * Which kind of transfer a progress report belongs to.
 *
 * libsession joins concurrent downloads of one file with each other but never joins a save, so one
 * attachment can have two live transfers at once. Keyed without this they interleave, and a bar
 * jumps backwards.
 */
export type AttachmentTransfer = 'download' | 'save'

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
export type AttachmentAvailability = 'cached' | 'fetching' | 'absent'

/** Accepted and verified: the only `AttachmentProgress.result` that means finished. */
export const ATTACHMENT_OK = 0
/** The file is no longer at the path it was attached from. Reported on an upload, never a fetch. */
export const ATTACHMENT_FILE_MISSING = -20001
/** It arrived but could not be turned back into the file it claims to be. Not worth retrying. */
export const ATTACHMENT_UNREADABLE = -20002

/**
 * An attachment on a stored message, in either direction.
 *
 * Nothing here says whether the bytes are on this device: that is answered by asking for them, and
 * `downloadAttachment` answers at once when they are already cached.
 */
export interface Attachment {
  /** Position in the message's list, and what every attachment call takes. */
  index: number
  /** The sender's claim on an incoming attachment: a display hint, not a fact about the bytes. */
  contentType?: string
  filename?: string
  /**
   * The file's size before encryption. Unset on an outgoing attachment that has not uploaded, and
   * the sender's claim on an incoming one. Not comparable with a progress report's `total`, which
   * counts encrypted bytes.
   */
  size?: number
  voiceMessage: boolean
  /** Supplied by whoever attached the file - libsession does not measure images. */
  width?: number
  height?: number
  /**
   * A BlurHash of the picture, for drawing something in its place before the bytes arrive.
   *
   * Carried and never parsed: libsession bounds its length and looks no further, so this is the
   * sender's claim like `width` and `height` beside it. Absent on everything sent by a client
   * that does not encode one, which today is every 1.x client.
   */
  blurhash?: string
  /**
   * On the file server: an outgoing attachment's upload finished, and always true for an incoming
   * one. Deliberately not "the bytes are here" - libsession records no local path, because the
   * application chose it and a stored copy would go stale the moment the file moved.
   */
  uploaded: boolean
  /**
   * Why the last fetch failed, when it failed in a way that trying again will not fix. Unset
   * means only that nothing has proved otherwise.
   *
   * A code rather than a flag, because the two cases are different things to tell somebody: 404,
   * which is how the file server answers for an upload it does not hold, is the sender's to
   * repair - the same file re-sent lands at the same url and puts the bytes back - and
   * `ATTACHMENT_UNREADABLE` is not. **Anything read off this needs a default**: what is recorded
   * is the code the failure carried, so a value nothing here anticipates is kept as itself
   * rather than flattened into "some other problem".
   */
  unavailable?: number
  /** Whether the bytes are here, coming, or neither. See `AttachmentAvailability`. */
  availability: AttachmentAvailability
  /**
   * How far the transfer has got while `availability` is `fetching`, and 0 otherwise.
   *
   * The same encrypted-byte figures `attachment-progress` carries, so a bar drawn from these and
   * then fed by reports continues rather than jumping. `fetchTotal` is 0 until the server has
   * said how big the file is. What they are for is a conversation opened while a download is
   * already running: the reports went to whoever started it.
   */
  fetchDone: number
  fetchTotal: number
  /**
   * When the recipient last saved it - us on an incoming attachment, the other party on one we
   * sent. Unset means *not known to have been saved*, which is not the same as not saved: it
   * depends on the other end volunteering a notification.
   */
  savedAt?: number
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
   * Whether this message's attachments could be shown as pictures rather than listed as files.
   * libsession's rule, not one to re-derive from content types: today it is "has attachments, and
   * every one of them is an image", and it may narrow.
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
  /** A count on the conversation, never a flag on a message: libsession has no per-message unread. */
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
