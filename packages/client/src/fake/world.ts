/**
 * A libsession that never touches a network.
 *
 * It exists so the UI, the store and the e2e suite can be built and run before the C++ shim
 * does, and so they can keep being tested afterwards without a devnet. It is not a stub:
 * it honours the parts of libsession's contract the app actually depends on -
 *
 *   - a send stores its row and reports it immediately, then moves through send states,
 *   - every change event carries the whole new state, never an id to go and fetch,
 *   - every change to a row says where it now belongs: the list and the row it follows,
 *   - approving a request moves it between lists in one placement,
 *   - a restart leaves anything still in flight `interrupted`.
 *
 * @session/client-contract runs the same scenarios against this and against the real bridge, so
 * the two cannot drift apart quietly.
 */

import { contentTypeEssence, isDisplayableImage, type WithDecodesHeic } from '@session/basic-types'
import {
  ATTACHMENT_NOT_FOUND,
  FILE_DOWNLOAD_CANCELLED,
  FILE_NOT_FOUND,
  FILE_UNREADABLE,
  MESSAGE_NOT_FOUND,
  type AccountInfo,
  type Attachment,
  type AttachmentAvailability,
  type AttachmentError,
  type AttachmentOutcome,
  type AttachmentRef,
  type AttachmentTransfer,
  type AutoDownload,
  type ConfigSize,
  type Conversation,
  type ConversationId,
  type ConversationList,
  type Deletion,
  type ListPlacement,
  type Message,
  type NetworkPaths,
  type NetworkStatus,
  type OutgoingAttachment,
  type QuotedMessage,
  type Reply,
  type RouterKind,
  type SendPlan,
  type SendState,
  type SessionEvent,
  type TransferProgress,
} from '@session/bridge-types'

import { SessionClientError } from '../errors'

import { fakeNetworkPaths, type FakePathTraffic } from './paths'
import { inferContentType } from './contentType'
import { fakeSendPlan, isReencoded, reencodedContentType } from './sendPlan'

/**
 * What the platform running the fake says of a file named to send, which the world cannot see
 * behind an app: whether it decodes HEIC, and the file's size, rejecting where there is none.
 */
export type FakeStagedFiles = WithDecodesHeic & {
  sizeOf?: ((path: string) => Promise<number>) | undefined
}

export interface FakeAccountOptions {
  displayName: string
  sessionId?: string
  /**
   * Whether an identity has been minted yet. True unless a fixture says otherwise, because almost
   * every scenario is about an app that is already past onboarding.
   *
   * False is the first-launch state, and it is the only way to reach the onboarding screens at
   * all: the app decides which to render from `haveAccount`, so a fake that is always true makes
   * that whole branch unreachable to anything driving the app.
   */
  haveAccount?: boolean
}

let seq = 0
/** Ids are sequential so a failing test names the same row every run. */
function nextId(): number {
  seq += 1
  return seq
}

export function resetFakeIds(): void {
  seq = 0
}

/**
 * What a transfer of `size` plaintext bytes moves.
 *
 * Progress counts encrypted bytes, which are more than the file is: a 24-byte header and 17 bytes
 * of framing per 32KiB chunk. Reproduced rather than approximated so that a caller reading a
 * percentage off `Attachment.sizeBytes` disagrees with the fake, as it would with libsession.
 */
function encryptedSize(sizeBytes: number): number {
  return 24 + sizeBytes + Math.ceil(sizeBytes / 32_768) * 17
}

/** How many reports a transfer makes between starting and finishing. */
const TRANSFER_STEPS = 20

/**
 * How many of the world's ticks a megabyte takes to move.
 *
 * A notional rate, so that a big file takes longer than a small one. Without it every transfer
 * ran for the same four ticks whatever its size, and a message's pictures all landed together -
 * which looks like a batch completing rather than files arriving, and hides every display that
 * is supposed to fill in one item at a time.
 *
 * Deliberately not a real bandwidth. What matters is that the durations differ in proportion to
 * the sizes, because that is the thing a display is laid out against.
 */
const TICKS_PER_MEGABYTE = 20

/**
 * How many rounds `settle` runs before giving up on a queue that keeps refilling itself. Well past
 * any real transfer: the showcase's retry uploads two 13 MB files one after the other, about 260.
 */
const SETTLE_ROUNDS = 1_000

/** The smallest a transfer can be, so a tiny file still reports a beginning and an end. */
const MIN_TRANSFER_TICKS = 2

/** How long this many encrypted bytes take, in the world's ticks. */
function transferTicks(bytes: number): number {
  return Math.max(Math.round((bytes / 1_000_000) * TICKS_PER_MEGABYTE), MIN_TRANSFER_TICKS)
}

/** The last component of a path, whichever separator the platform that picked it uses. */
function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/** libsession's rule: has attachments, and every one of them is a displayable image. */
function galleryViewable(attachments: Attachment[]): boolean {
  return attachments.length > 0 && attachments.every((a) => isDisplayableImage(a.contentType))
}

/** What a recipient is told of the files a message of ours carried: up, and not fetched. */
function received(sent: readonly Attachment[]): Attachment[] {
  return sent.map((attachment) => ({
    ...attachment,
    uploaded: true,
    hasThumbnail: false,
    thumbnailWidthPx: 0,
    thumbnailHeightPx: 0,
    availability: 'absent',
    fetchDoneBytes: 0,
    fetchTotalBytes: 0,
  }))
}

/** What `send` was given for one file, kept for that file's turn to upload. */
interface Upload {
  path: string
  sizeBytes: number | undefined
  originalFile: boolean
  /** What libsession re-encodes the file as when its upload comes up; unset when sent as it is. */
  reencodedAs: 'image/jpeg' | 'image/webp' | undefined
}

/** `std::filesystem::path::replace_extension`, as libsession renames a re-encoded file. */
function withExtension(name: string, extension: string): string {
  const dot = name.lastIndexOf('.')
  return (dot > 0 ? name.slice(0, dot) : name) + extension
}

/** The row libsession rewrites for a file it re-encoded: the new type, and a name to match. */
function reencoded(attachment: Attachment, contentType: 'image/jpeg' | 'image/webp'): Attachment {
  const extension = contentType === 'image/webp' ? '.webp' : '.jpg'
  return {
    ...attachment,
    contentType,
    ...(attachment.filename === undefined
      ? {}
      : { filename: withExtension(attachment.filename, extension) }),
  }
}

/** libsession's bounds on a thumbnail's height: a 2389 x 1024 strip is about 9.3 MiB decoded. */
const THUMBNAIL_EDGE_MIN_PX = 64
const THUMBNAIL_EDGE_MAX_PX = 1024
/** The height `pnpm fake-media:fetch` makes the dev thumbnails, so what is served is this tall. */
const FAKE_THUMBNAIL_EDGE_PX = 720
/** Every dev photograph is 1600 x 1200, so every thumbnail served is 4:3 at that height. */
const FAKE_THUMBNAIL_WIDTH_PX = 960

/**
 * What every dev photograph's hash says of its shape: a 4:3 photograph's hash keeps seven
 * luminance components across and five down. The fake draws every hashed picture as one of them.
 */
const FAKE_THUMBHASH_ASPECT = 7 / 5

/** libsession's `max_frame_pixels`: past it, it decodes nothing of a picture. */
const MAX_FRAME_PIXELS = 268_402_689

/** Past libsession's pixel limits, by the size the sender gave, which is all the fake reads. */
function pastPixelLimits(attachment: Attachment): boolean {
  return (
    attachment.width !== undefined &&
    attachment.height !== undefined &&
    attachment.width * attachment.height > MAX_FRAME_PIXELS
  )
}

/**
 * libsession makes one of every displayable picture it caches and decodes, and drops it on
 * eviction; and one of every picture we send, from its own copy before the upload, which the
 * cached one replaces.
 */
function thumbnailed(held: boolean, attachment: Attachment | undefined): boolean {
  return (
    held &&
    attachment !== undefined &&
    isDisplayableImage(attachment.contentType) &&
    !pastPixelLimits(attachment)
  )
}

/**
 * Whether a rendition could be made: of a thumbnailed picture, and never of a file sent as its
 * original, which is only exported. Made only once a viewer asks, as libsession does.
 */
function renderable(cached: boolean, attachment: Attachment): boolean {
  return thumbnailed(cached, attachment) && !attachment.originalFile
}

/** libsession settles a refusal once it reads the cached file, as it makes the thumbnail. */
function refusesRendition(cached: boolean, attachment: Attachment): boolean {
  return (
    cached &&
    isDisplayableImage(attachment.contentType) &&
    !attachment.originalFile &&
    pastPixelLimits(attachment)
  )
}

function wantedBy(mode: AutoDownload | undefined, attachment: Attachment): boolean {
  if (mode === 'all') return true
  if (mode === 'image-attachments') return isDisplayableImage(attachment.contentType)
  return false
}

/** A message as the wire names it, which is all a quote carries: who sent it and when. */
export type FakeQuote = Pick<Reply, 'author' | 'timestamp'>

function answers(reply: FakeQuote | undefined, original: Message): boolean {
  return reply?.author === original.author && reply.timestamp === original.timestamp
}

function keyOf({ messageId, index }: AttachmentRef): string {
  return `${messageId}:${index}`
}

/** What libsession records when a download says retrying is pointless. */
type Verdict = Extract<AttachmentAvailability, 'notFound' | 'unreadable'>

const VERDICT_ERRORS: Record<Verdict, AttachmentError> = {
  notFound: FILE_NOT_FOUND,
  unreadable: FILE_UNREADABLE,
}

/**
 * libsession's refusal of a file it has a verdict on: thrown before any transfer exists, so it
 * rejects with nothing on the stream, as the real one does.
 */
function refuseVerdict(ref: AttachmentRef, verdict: Verdict): Promise<never> {
  const what = `ttachment ${String(ref.index)} of message ${String(ref.messageId)}`
  const message =
    verdict === 'notFound'
      ? `The file server no longer has a${what}`
      : `A${what} cannot be read as its sender described it`
  return Promise.reject(new SessionClientError(message, VERDICT_ERRORS[verdict]))
}

function refuseMissing(ref: AttachmentRef, messageExists: boolean): Promise<never> {
  const id = String(ref.messageId)
  return Promise.reject(
    messageExists
      ? new SessionClientError(
          `Message ${id} has no attachment ${String(ref.index)}`,
          ATTACHMENT_NOT_FOUND,
        )
      : new SessionClientError(`There is no message ${id}`, MESSAGE_NOT_FOUND),
  )
}

function isVerdict(availability: AttachmentAvailability): availability is Verdict {
  return availability in VERDICT_ERRORS
}

/** Somebody waiting on a transfer: a download's caller, an auto-download, or an export. */
interface Consumer {
  kind: AttachmentTransfer
  resolve: () => void
  reject: (error: unknown) => void
}

/** One fetch of one attachment's bytes, and everybody waiting on it. */
interface Transfer {
  ref: AttachmentRef
  progress: TransferProgress
  consumers: Consumer[]
}

export interface LocatedAttachment {
  conversationId: ConversationId
  message: Message
  attachment: Attachment
}

interface FakeConversationState {
  conversation: Conversation
  /** As stored: a reply holds only its `FakeQuote`, which `withAvailability` resolves. */
  messages: Message[]
  /**
   * The read watermark, in epoch milliseconds: an incoming message is unread when it is newer
   * than this. A watermark rather than a set of message ids because that is libsession's model, and
   * the two disagree about a late arrival older than the mark - libsession counts it read. Held
   * beside the messages because libsession reports nothing per message, so it is the fake's own
   * bookkeeping and does not belong on the wire.
   */
  lastReadMs: number
}

/** What libsession counts as unread: incoming, not deleted, and newer than the watermark. */
function unreadIn(state: FakeConversationState): Message[] {
  return state.messages.filter(
    (m) => !m.outgoing && m.deleted === undefined && m.timestamp > state.lastReadMs,
  )
}

export class FakeAccount {
  readonly sessionId: string
  displayName: string
  haveAccount: boolean
  /** Only once there is an account to attach it to, as libsession refuses a network before one. */
  networkAttached = false
  /**
   * Whether a network was accepted, to attach once there is an account.
   *
   * Survives a discard, as the bridge's network options do: the network is the device's choice,
   * not the account's, so the account made next goes online on it too.
   */
  networkPlanned = false
  /** How the accepted network sends, which decides what paths it reports. */
  networkRouter: RouterKind = 'session-router'
  networkStatus: NetworkStatus = 'disconnected'
  /** When the network last connected, on the paths' clock; null while it is not connected. */
  connectedAtMs: number | null = null
  /**
   * When a restored profile becomes visible, or 0 where there is nothing outstanding.
   *
   * Only a restore sets it. A new account names itself the moment it is named, and an account
   * that was already here has had its name all along.
   */
  profileArrivesAt = 0
  /**
   * Whether this account was minted and never confirmed.
   *
   * Set the moment one comes into being and cleared by `keepAccount`. A restart with it still set
   * is a crash partway through setting the account up, and the account does not survive it — the
   * real bridge sweeps the database, this empties the account, and both leave a device that starts
   * over rather than one holding an identity nobody finished with.
   */
  provisional = false

  /**
   * Whether the recovery password was hidden, which libsession keeps with the account rather than
   * among the preferences: nothing but hiding sets it, and it goes when the account does.
   */
  recoveryPasswordHidden = false

  private readonly conversations = new Map<ConversationId, FakeConversationState>()
  /** Which list each row was last reported in, which is the `from` its next placement gives. */
  private readonly placed = new Map<ConversationId, ConversationList>()
  private readonly listeners = new Set<(event: SessionEvent) => void>()
  private readonly prefs = new Map<string, string>()
  private world: FakeWorld | undefined
  /** Attachments whose bytes are in the cache, by `keyOf`. */
  private readonly cached = new Set<string>()
  /**
   * Files a send took or copied and has not uploaded yet, by `keyOf`: served from libsession's
   * outgoing folder until then, but not in the cache, so not counted in its size. A picture's
   * thumbnail is made from it. Each with its size, where the world knows it.
   */
  private readonly taken = new Map<string, number | undefined>()
  /** Renditions a viewer asked for, by `keyOf`, and those made since. */
  private readonly renditionsAsked = new Set<string>()
  private readonly renditions = new Set<string>()
  /** What a send's files were sent as, by message id, for a retry to upload the rest of. */
  private readonly uploadsOf = new Map<number, readonly Upload[]>()
  /**
   * The attempt each message's uploads belong to, by message id: a step scheduled by an attempt a
   * restart failed reports nothing once a retry has started another.
   */
  private readonly uploadAttempts = new Map<number, symbol>()
  /**
   * Transfers in flight, by `keyOf`, so a second request for a file joins its transfer rather than
   * starting another - a download and an export alike, as libsession keys both by the file.
   */
  private readonly transfers = new Map<string, Transfer>()
  /**
   * Attachments a download has judged unavailable, by `keyOf`. Seeded from a fixture's
   * `availability`, since the fake has no file server to reach the verdict against.
   */
  private readonly verdicts = new Map<string, Verdict>()
  /** Paths exported to, so a repeat can collide the way a file on disk would. */
  private readonly exported = new Set<string>()
  private cacheLimitBytes: number | undefined
  private storedThumbnailEdgePx: number | undefined
  private stagedFiles: FakeStagedFiles = { decodesHeic: false }

  constructor(options: FakeAccountOptions) {
    this.displayName = options.displayName
    this.sessionId = options.sessionId ?? `05${options.displayName.toLowerCase().padEnd(64, '0')}`
    this.haveAccount = options.haveAccount ?? true
  }

  attachTo(world: FakeWorld): void {
    this.world = world
  }

  subscribe(listener: (event: SessionEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(event: SessionEvent): void {
    for (const listener of [...this.listeners]) listener(event)
  }

  accountInfo(): AccountInfo {
    // An ID and a name only once there is an account to have them. The fake knows this account's
    // ID from the moment the world is built, because the world wires conversations up by it -
    // but libsession has nothing to report before the seed exists, and a screen that reads an ID
    // off an account that has not been made yet works here and throws there.
    if (!this.haveAccount) return { haveAccount: false, networkAttached: this.networkAttached }
    // A restore has the identity before it has the profile. Reported the way libsession reports
    // it -- the field is simply absent -- rather than as an empty string, which a screen would
    // have to know to treat as missing.
    const named = this.profileArrivesAt === 0 || Date.now() >= this.profileArrivesAt
    return {
      haveAccount: true,
      sessionId: this.sessionId,
      ...(named ? { displayName: this.displayName } : {}),
      networkAttached: this.networkAttached,
    }
  }

  /** Changes the status and says so, never twice in a row for the same one, as libsession. */
  setNetworkStatus(status: NetworkStatus): void {
    if (this.networkStatus === status) return
    this.networkStatus = status
    this.connectedAtMs = status === 'connected' ? (this.world?.pathNow() ?? Date.now()) : null
    this.emit({ type: 'network-status-changed', status })
  }

  /**
   * Attaches the planned network once there is an account, as the bridge does: `unknown` at once,
   * connecting a tick later and a path a tick after that, on the world's clock. The bridge reports
   * the status the Network has as soon as it exists, which is libsession's `unknown`: its transport
   * and router report through its own queue, after the constructor has returned. Nothing where
   * there is no plan, no account yet, or a network already attached.
   */
  goOnline(): void {
    if (!this.networkPlanned || !this.haveAccount || this.networkAttached) return
    this.networkAttached = true
    this.setNetworkStatus('unknown')
    this.world?.schedule(1, () => {
      if (this.networkAttached) this.setNetworkStatus('connecting')
    })
    this.world?.schedule(2, () => {
      if (this.networkAttached) this.setNetworkStatus('connected')
    })
  }

  /**
   * Back to a device with nothing on it, the way discarding an account leaves one.
   *
   * Everything the account accumulated goes: the identity, the conversations, the history, the
   * preferences. The session ID is kept because it is derived from the fixture's name and the
   * world wires peers up by it -- what matters for the behaviour under test is that
   * `haveAccount` is false, which is what `accountInfo` reports off.
   */
  discard(): void {
    // The bridge closes the database and the Network with it, which reports going on its way out.
    if (this.networkAttached) {
      this.networkAttached = false
      this.setNetworkStatus('disconnected')
    }
    this.haveAccount = false
    this.provisional = false
    this.recoveryPasswordHidden = false
    this.profileArrivesAt = 0
    this.conversations.clear()
    this.placed.clear()
    this.prefs.clear()
  }

  /** Approved conversations, ordered the way the app shows them. */
  list(): Conversation[] {
    return this.ordered((c) => !c.request)
  }

  requests(): Conversation[] {
    return this.ordered((c) => c.request)
  }

  /** A hidden conversation, priority below zero, is in neither list. */
  private ordered(predicate: (c: Conversation) => boolean): Conversation[] {
    return [...this.conversations.values()]
      .map((state) => state.conversation)
      .filter((c) => c.priority >= 0 && predicate(c))
      .sort(
        (a, b) =>
          b.priority - a.priority || b.lastActivity - a.lastActivity || a.id.localeCompare(b.id),
      )
  }

  get(id: ConversationId): Conversation | undefined {
    return this.conversations.get(id)?.conversation
  }

  messages(id: ConversationId): Message[] {
    return [...(this.conversations.get(id)?.messages ?? [])]
  }

  getPref(key: string): string | undefined {
    return this.prefs.get(key)
  }

  setPref(key: string, value: string): void {
    this.prefs.set(key, value)
  }

  /**
   * Where a row was last reported and where it belongs now, recording the latter: libsession's
   * `_place`. A row the app read for itself and was never told about has no `from`, which is how
   * libsession answers too.
   */
  private place(conversation: Conversation): ListPlacement {
    const from = this.placed.get(conversation.id) ?? 'none'
    if (conversation.priority < 0) {
      this.placed.delete(conversation.id)
      return { from, to: 'none' }
    }
    const to = conversation.request ? 'requests' : 'conversations'
    this.placed.set(conversation.id, to)
    const list = to === 'requests' ? this.requests() : this.list()
    const before = list[list.findIndex((c) => c.id === conversation.id) - 1]
    return before === undefined ? { from, to } : { from, to, after: before.id }
  }

  /**
   * A row's change with where it now belongs, as libsession reports every change to a list: a new
   * message, a pin or a hide, an approval. The fake changes one row at a time, so the order a
   * batch is sent in, which libsession has to choose, never arises here.
   */
  private announceRow(before: Conversation | undefined, after: Conversation): void {
    this.emit({
      type: before === undefined ? 'conversation-added' : 'conversation-updated',
      conversation: after,
      placement: this.place(after),
    })
  }

  /** Adds a conversation and announces it, the way libsession would on first contact. */
  upsertConversation(conversation: Conversation, { announce = true } = {}): Conversation {
    const existing = this.conversations.get(conversation.id)
    const state: FakeConversationState = existing
      ? { conversation, messages: existing.messages, lastReadMs: existing.lastReadMs }
      : { conversation, messages: [], lastReadMs: 0 }
    this.conversations.set(conversation.id, state)

    if (!announce) return conversation

    // Approval arrives as an update rather than a remove plus an add, so a display that
    // keeps two lists needs both of them re-sent to move the row across.
    this.announceRow(existing?.conversation, conversation)
    return conversation
  }

  touch(id: ConversationId, patch: Partial<Conversation>): Conversation | undefined {
    const state = this.conversations.get(id)
    if (!state) return undefined
    return this.replace({ ...state.conversation, ...patch })
  }

  /**
   * Puts a whole conversation back and announces it. Clearing an optional field needs this
   * rather than touch(): a patch cannot express "remove the nickname".
   */
  replace(conversation: Conversation): Conversation | undefined {
    const state = this.conversations.get(conversation.id)
    if (!state) return undefined
    this.conversations.set(conversation.id, { ...state, conversation })
    this.announceRow(state.conversation, conversation)
    return conversation
  }

  addMessage(id: ConversationId, message: Message): Message {
    const state = this.conversations.get(id)
    if (!state) throw new Error(`No conversation ${id}`)
    for (const attachment of message.attachments) {
      if (isVerdict(attachment.availability))
        this.verdicts.set(
          keyOf({ messageId: message.id, index: attachment.index }),
          attachment.availability,
        )
    }
    state.messages.push(message)
    state.messages.sort((a, b) => a.timestamp - b.timestamp || a.id - b.id)

    const conversation: Conversation = {
      ...state.conversation,
      // Only ever forwards, as libsession moves it: a message can arrive dated before the last.
      lastActivity: Math.max(state.conversation.lastActivity, message.timestamp),
      snippet: message.body,
      unreadCount: unreadIn(state).length,
      // Writing to someone is what approves them, as in libsession: a request written back to
      // leaves the requests for the conversations.
      ...(message.outgoing ? { request: false } : {}),
    }
    this.conversations.set(id, { ...state, conversation })

    // A batch of one: the fake delivers a message at a time, which is a batch the real
    // bridge could also produce. A handler that only works on larger ones is broken.
    this.announce('messages-added', [message])
    this.announceRow(state.conversation, conversation)
    return message
  }

  updateMessage(id: ConversationId, messageId: number, patch: Partial<Message>): void {
    const state = this.conversations.get(id)
    if (!state) return
    const index = state.messages.findIndex((m) => m.id === messageId)
    const existing = state.messages[index]
    if (index < 0 || !existing) return
    const updated: Message = { ...existing, ...patch }
    state.messages[index] = updated
    this.announce('messages-updated', [updated])
  }

  /**
   * Moves the watermark to `upToMs`, inclusive, or to the newest incoming message when it is left
   * out - which, as in libsession, reads what is here now rather than everything that ever
   * arrives. Never moves it backwards and clears `markedUnread`, and announces the row only when
   * one of the two changed, as libsession does. Left out with no incoming message to read up to,
   * libsession changes nothing at all, `markedUnread` included, and so does this.
   */
  markRead(id: ConversationId, upToMs?: number): void {
    const state = this.conversations.get(id)
    if (!state) return
    const incoming = state.messages.filter((m) => !m.outgoing && m.deleted === undefined)
    if (upToMs === undefined && incoming.length === 0) return
    const target = upToMs ?? Math.max(...incoming.map((m) => m.timestamp))
    const next: FakeConversationState = { ...state, lastReadMs: Math.max(state.lastReadMs, target) }
    const conversation: Conversation = {
      ...state.conversation,
      unreadCount: unreadIn(next).length,
      markedUnread: false,
    }
    this.conversations.set(id, { ...next, conversation })
    if (
      next.lastReadMs === state.lastReadMs &&
      state.conversation.markedUnread === conversation.markedUnread
    )
      return
    this.announceRow(state.conversation, conversation)
  }

  /**
   * Empties a message in place, as libsession does: the row stays, so a gap can be drawn where it
   * was, and its body and its attachments' rows go. Its scope only widens: a delete "here" after
   * one "everywhere" leaves it deleted everywhere.
   */
  deleteMessage(messageId: number, scope: Deletion): void {
    for (const [id, state] of this.conversations) {
      const message = state.messages.find((m) => m.id === messageId)
      if (!message) continue
      this.updateMessage(id, messageId, {
        deleted: message.deleted === 'everywhere' ? 'everywhere' : scope,
        body: '',
        attachments: [],
        galleryViewable: false,
        gallery: false,
      })
      this.withdrawOrphanedTransfers()
      return
    }
  }

  clearHistory(id: ConversationId): void {
    const state = this.conversations.get(id)
    if (!state) return
    this.conversations.set(id, { ...state, messages: [] })
    this.withdrawOrphanedTransfers()
    this.emit({ type: 'history-replaced', conversationId: id })
  }

  removeConversation(id: ConversationId): void {
    if (!this.conversations.delete(id)) return
    this.withdrawOrphanedTransfers()
    const list = this.placed.get(id) ?? 'none'
    this.placed.delete(id)
    this.emit({ type: 'conversation-removed', conversationId: id, list })
  }

  /**
   * Anything still in flight when the process stopped comes back interrupted: libsession's
   * send queue does not survive a restart, and a UI that has never seen this state will
   * show a spinner for ever after a crash.
   */
  restart(): void {
    // A transfer is not stored anywhere, so one that was running is simply gone: its remaining
    // reports are dropped and whoever was waiting is told, rather than left holding a promise.
    const lost = [...this.transfers.values()]
    this.transfers.clear()
    for (const { consumers } of lost)
      for (const consumer of consumers)
        consumer.reject(new Error('the transfer did not survive the restart'))
    // An account nobody confirmed does not survive a restart, the way it does not survive one
    // against the real bridge. Checked before the send states are settled, because there is no
    // point settling messages that are about to be thrown away with the account.
    if (this.provisional && this.haveAccount) {
      this.discard()
      return
    }

    const inFlight: SendState[] = ['pending', 'sending']
    for (const [id, state] of this.conversations) {
      for (const message of state.messages) {
        // Pending counts: the row was stored but never handed to the network, and the
        // queue that would have done it is gone with the process.
        if (inFlight.includes(message.sendState)) {
          this.updateMessage(id, message.id, { sendState: 'interrupted' })
        }
        // The sync send is its own queue entry, so it is interrupted on its own terms - a
        // message whose recipient copy landed before the crash still has a sync that did not.
        if (message.syncState !== undefined && inFlight.includes(message.syncState)) {
          this.updateMessage(id, message.id, { syncState: 'interrupted' })
        }
        // Nothing can have reached a swarm while its files were still uploading, so that is a
        // failure rather than an unknown, and a retry uploads only what did not get up.
        if (message.sendState === 'uploading') {
          this.updateMessage(id, message.id, {
            sendState: 'failed',
            ...(message.syncState === 'uploading' ? { syncState: 'failed' } : {}),
          })
        }
      }
    }
  }

  deliverFrom(
    sender: FakeAccount,
    body: string,
    timestamp: number,
    attachments: Attachment[] = [],
    replyTo?: FakeQuote,
  ): Message {
    const conversationId = sender.sessionId
    if (!this.conversations.has(conversationId)) {
      this.upsertConversation({
        id: conversationId,
        kind: 'dm',
        displayName: sender.displayName,
        lastActivity: timestamp,
        priority: 0,
        unreadCount: 0,
        markedUnread: false,
        // Someone we have never spoken to lands in message requests, not the main list.
        request: true,
        awaitingApproval: false,
        noteToSelf: false,
        blocked: false,
      })
    }

    const message = this.addMessage(conversationId, {
      id: nextId(),
      conversationId,
      author: sender.sessionId,
      timestamp,
      body,
      outgoing: false,
      sendState: 'sent',
      attachments,
      galleryViewable: galleryViewable(attachments),
      gallery: galleryViewable(attachments),
      ...(replyTo === undefined
        ? {}
        : { replyTo: { author: replyTo.author, timestamp: replyTo.timestamp } }),
    })

    // Whatever the conversation said to fetch unasked, fetched now. Unset means nobody has been
    // asked yet, and nothing is fetched while it is unset.
    const mode = this.get(conversationId)?.autoDownload
    for (const attachment of attachments) {
      // Caught rather than voided: nobody asked for this one, so there is nobody to tell when a
      // restart cancels it, and an unhandled rejection would take a test run down with it.
      if (wantedBy(mode, attachment)) {
        this.downloadAttachment({ messageId: message.id, index: attachment.index }).catch(
          () => undefined,
        )
      }
    }
    return message
  }

  readStagedFilesWith(files: FakeStagedFiles): void {
    this.stagedFiles = files
  }

  /** libsession's `attachment_send_plan`, as `fakeSendPlan` can decide it. */
  async sendPlan(path: string, contentType?: string): Promise<SendPlan> {
    let sizeBytes = this.world?.fileSize(path)
    if (sizeBytes === null) return 'missing'
    if (sizeBytes === undefined && this.stagedFiles.sizeOf !== undefined) {
      try {
        sizeBytes = await this.stagedFiles.sizeOf(path)
      } catch {
        return 'missing'
      }
    }
    return fakeSendPlan(
      contentType ?? inferContentType(baseName(path)),
      sizeBytes,
      this.stagedFiles,
    )
  }

  /**
   * Stores a message of ours and starts sending it. With attachments it is `uploading` first,
   * one file a step in order, as libsession uploads them; the send proper follows the last.
   *
   * Throws, storing nothing, when a file is not a readable, non-empty one, or `replyTo` is not a
   * message of this conversation, as libsession does. A deleted message can still be answered.
   */
  send(
    id: ConversationId,
    body: string,
    replyTo?: number,
    outgoing: readonly OutgoingAttachment[] = [],
  ): number {
    const sizes = outgoing.map(({ path }) => {
      const sizeBytes = this.world?.fileSize(path)
      if (sizeBytes === null)
        throw new SessionClientError(`send_message: attachment ${path} is not a readable file`)
      if (sizeBytes === 0) throw new SessionClientError(`send_message: attachment ${path} is empty`)
      return sizeBytes
    })
    const uploads = outgoing.map((file, index): Upload => {
      const contentType = file.contentType ?? inferContentType(baseName(file.path))
      return {
        path: file.path,
        sizeBytes: sizes[index],
        // libsession sends a picture it cannot decode as it is, flagged.
        originalFile:
          contentTypeEssence(contentType)?.startsWith('image/') === true &&
          !isReencoded(contentType, this.stagedFiles),
        reencodedAs: isReencoded(contentType, this.stagedFiles)
          ? reencodedContentType(contentType)
          : undefined,
      }
    })
    const answered =
      replyTo === undefined
        ? undefined
        : this.conversations.get(id)?.messages.find((m) => m.id === replyTo)
    if (replyTo !== undefined && answered === undefined)
      throw new SessionClientError(
        `send_message: reply_to message ${String(replyTo)} does not exist in this conversation`,
      )
    const now = this.world?.now() ?? Date.now()
    const uploading = outgoing.length > 0
    const attachments = outgoing.map((file, index): Attachment => {
      const contentType = file.contentType ?? inferContentType(baseName(file.path))
      return {
        index,
        contentType,
        filename: file.filename ?? baseName(file.path),
        voiceMessage: false,
        hasThumbhash: false,
        hasThumbnail: false,
        thumbnailWidthPx: 0,
        thumbnailHeightPx: 0,
        hasRendition: false,
        renditionRefused: false,
        // Flagged by libsession as that file's upload starts, when it converts it.
        originalFile: false,
        // Recorded by libsession as the send stores the file, before any upload.
        ...(sizes[index] === undefined ? {} : { sizeBytes: sizes[index] }),
        uploaded: false,
        availability: 'absent',
        fetchDoneBytes: 0,
        fetchTotalBytes: 0,
      }
    })
    const message: Message = {
      id: nextId(),
      conversationId: id,
      author: this.sessionId,
      timestamp: now,
      body,
      outgoing: true,
      // Stored and shown before it is sent - which is why the app needs no optimistic copy.
      sendState: uploading ? 'uploading' : 'pending',
      attachments,
      galleryViewable: galleryViewable(attachments),
      gallery: galleryViewable(attachments),
      // A second send, to our own swarm, so our other devices see it. Left unset on an incoming
      // message, which is why `deliverFrom` does not set one.
      syncState: uploading ? 'uploading' : 'pending',
      ...(answered === undefined
        ? {}
        : { replyTo: { author: answered.author, timestamp: answered.timestamp } }),
    }
    // libsession copies a file it was not handed at once, where it takes a handed one; either
    // way the message reads only its own from here, and the caller's may go.
    outgoing.forEach((_file, index) => {
      this.taken.set(keyOf({ messageId: message.id, index }), sizes[index])
    })
    this.addMessage(id, message)
    for (const file of outgoing) if (file.takeFile === true) this.world?.removeFile(file.path)
    if (uploading) {
      this.uploadsOf.set(message.id, uploads)
      this.startUploads(id, message.id, uploads)
    } else this.world?.scheduleSend(this, id, message)
    return message.id
  }

  /** Starts an attempt at a message's uploads, which any earlier attempt then stays out of. */
  private startUploads(id: ConversationId, messageId: number, uploads: readonly Upload[]): void {
    const attempt = Symbol(`uploads of ${String(messageId)}`)
    this.uploadAttempts.set(messageId, attempt)
    this.uploadNext(id, messageId, uploads, attempt)
  }

  /**
   * Uploads the first file not up yet, a step from now, then the next, then sends.
   *
   * Each file reports as libsession's upload handler does: 0 of 0 as it starts, then encrypted
   * bytes on the world's clock, then one report with the outcome. Nothing is reported before the
   * send has answered, since the first step is a tick away.
   */
  private uploadNext(
    id: ConversationId,
    messageId: number,
    uploads: readonly Upload[],
    attempt: symbol,
  ): void {
    const world = this.world
    if (world === undefined) return
    // A restart failed it, it was deleted, or a retry started another attempt.
    const live = (): Message | undefined => {
      const message = this.messages(id).find((m) => m.id === messageId)
      return message?.sendState === 'uploading' && this.uploadAttempts.get(messageId) === attempt
        ? message
        : undefined
    }
    world.schedule(1, () => {
      const message = live()
      if (message === undefined) return
      const at = message.attachments.findIndex((a) => !a.uploaded)
      const attachment = message.attachments[at]
      if (attachment === undefined) {
        this.uploadsOf.delete(messageId)
        this.uploadAttempts.delete(messageId)
        this.updateMessage(id, messageId, {
          sendState: 'pending',
          ...(message.syncState === undefined ? {} : { syncState: 'pending' }),
        })
        world.scheduleSend(this, id, { ...message, sendState: 'pending' })
        return
      }
      const upload = uploads[at]
      if (upload === undefined) return
      const index = attachment.index
      const report = (doneBytes: number, totalBytes: number, outcome?: AttachmentOutcome): void => {
        this.emit({
          type: 'attachment-progress',
          transfer: 'upload',
          messageId,
          index,
          doneBytes,
          totalBytes,
          ...(outcome === undefined ? {} : { outcome }),
        })
      }
      const totalBytes = encryptedSize(upload.sizeBytes ?? 0)
      report(0, 0)

      const span = transferTicks(totalBytes)
      for (let i = 1; i < TRANSFER_STEPS; i += 1) {
        world.schedule((span * i) / TRANSFER_STEPS, () => {
          if (live() !== undefined)
            report(Math.round((totalBytes * i) / TRANSFER_STEPS), totalBytes)
        })
      }
      world.schedule(span, () => {
        const current = live()
        if (current === undefined) return
        // As libsession: what we sent is kept in the cache, and its size is known once it is up.
        this.cached.add(keyOf({ messageId, index }))
        this.taken.delete(keyOf({ messageId, index }))
        const { sizeBytes, originalFile, reencodedAs } = upload
        const attachments = current.attachments.map((a) => {
          if (a.index !== index) return a
          const up: Attachment = {
            ...a,
            uploaded: true,
            originalFile,
            ...(sizeBytes === undefined ? {} : { sizeBytes }),
          }
          return reencodedAs === undefined ? up : reencoded(up, reencodedAs)
        })
        const viewable = galleryViewable(attachments)
        // Recorded before it is reported, as libsession records the file's URL first.
        this.updateMessage(id, messageId, {
          attachments,
          galleryViewable: viewable,
          // As libsession: only the conversion that makes the set viewable turns the gallery on;
          // once it was viewable, the stored choice is the reader's.
          ...(viewable && !current.galleryViewable ? { gallery: true } : {}),
        })
        report(totalBytes, totalBytes, { ok: true })
        this.uploadNext(id, messageId, uploads, attempt)
      })
    })
  }

  /**
   * A message of ours caught partway through sending its files, for a fixture to show: `send`
   * passes through every state too quickly to look at. The first `uploaded` files are on the
   * file server.
   */
  seedSending(
    id: ConversationId,
    body: string,
    attachments: Attachment[],
    sendState: SendState,
    uploaded: number,
    replyTo?: FakeQuote,
  ): Message {
    const now = this.world?.now() ?? Date.now()
    const messageId = nextId()
    // As libsession leaves them: an uploaded file is in the cache, kept there by the upload, and
    // one that is not up yet is libsession's own copy, with no size, which is the uploaded
    // pointer's to report. An unsendable seed stands for a file gone before its copy was made.
    const seeded = attachments.map((attachment, index) => {
      const key = keyOf({ messageId, index: attachment.index })
      if (index < uploaded) {
        this.cached.add(key)
        return { ...attachment, uploaded: true }
      }
      // Its size kept, as libsession records a file's size when the send stores it.
      if (sendState !== 'unsendable') this.taken.set(key, attachment.sizeBytes)
      return { ...attachment, uploaded: false }
    })
    return this.addMessage(id, {
      id: messageId,
      conversationId: id,
      author: this.sessionId,
      timestamp: now,
      body,
      outgoing: true,
      sendState,
      attachments: seeded,
      galleryViewable: galleryViewable(seeded),
      gallery: galleryViewable(seeded),
      syncState: sendState,
      ...(replyTo === undefined
        ? {}
        : { replyTo: { author: replyTo.author, timestamp: replyTo.timestamp } }),
    })
  }

  /**
   * A message of ours sent from another of our devices: sent, every file on the file server, and
   * none of them in this device's cache, so each downloads as an incoming file does.
   */
  seedFromOtherDevice(id: ConversationId, body: string, attachments: Attachment[]): Message {
    return this.addMessage(id, {
      id: nextId(),
      conversationId: id,
      author: this.sessionId,
      timestamp: this.world?.now() ?? Date.now(),
      body,
      outgoing: true,
      sendState: 'sent',
      attachments,
      galleryViewable: galleryViewable(attachments),
      gallery: galleryViewable(attachments),
    })
  }

  /**
   * libsession's `retry_send`: from `failed` or `interrupted` only, uploading what has no URL yet
   * and keeping what has, then sending, through the same steps a first send takes.
   */
  resumeSend(messageId: number): boolean {
    for (const [id, state] of this.conversations) {
      const message = state.messages.find((m) => m.id === messageId)
      if (message === undefined) continue
      if (message.sendState !== 'failed' && message.sendState !== 'interrupted') return false
      // As libsession: back to uploading while a file is not up yet, else queued for the send.
      const resumed = message.attachments.every((a) => a.uploaded) ? 'pending' : 'uploading'
      this.updateMessage(id, messageId, {
        sendState: resumed,
        ...(message.syncState === undefined ? {} : { syncState: resumed }),
      })
      if (resumed === 'pending') {
        this.world?.scheduleSend(this, id, { ...message, sendState: 'pending' })
        return true
      }
      this.startUploads(id, messageId, this.uploadsOf.get(messageId) ?? this.seededUploads(message))
      return true
    }
    return false
  }

  /**
   * The uploads of a message `seedSending` made, which no send handed files to: each carries the
   * size recorded for its file.
   */
  private seededUploads(message: Message): Upload[] {
    return message.attachments.map((attachment) => ({
      path: '',
      sizeBytes: attachment.sizeBytes,
      originalFile: attachment.originalFile,
      reencodedAs: undefined,
    }))
  }

  /**
   * libsession's `set_gallery`: false for a message that is not here, or for turning a gallery on
   * where `galleryViewable` does not hold. Asking for what is stored announces nothing.
   */
  setGallery(messageId: number, gallery: boolean): boolean {
    for (const [id, state] of this.conversations) {
      const message = state.messages.find((m) => m.id === messageId)
      if (message === undefined) continue
      if (gallery && !message.galleryViewable) return false
      if (message.gallery !== gallery) this.updateMessage(id, messageId, { gallery })
      return true
    }
    return false
  }

  // -- Attachments ---------------------------------------------------------------------------

  /** The attachment and the conversation it hangs off, or undefined if there is no such pair. */
  locate(ref: AttachmentRef): LocatedAttachment | undefined {
    for (const [conversationId, state] of this.conversations) {
      const message = state.messages.find((m) => m.id === ref.messageId)
      const attachment = message?.attachments.find((a) => a.index === ref.index)
      if (message && attachment) return { conversationId, message, attachment }
    }
    return undefined
  }

  private hasMessage(messageId: number): boolean {
    for (const [, state] of this.conversations) {
      if (state.messages.some((m) => m.id === messageId)) return true
    }
    return false
  }

  /** Whether a taken file is still served: libsession drops it once its send is unsendable. */
  private takenServed(key: string, sendState: SendState | undefined): boolean {
    return this.taken.has(key) && sendState !== 'unsendable'
  }

  /** A taken file's size while it is served, for the media source to answer bytes of it. */
  takenSizeBytes(ref: AttachmentRef): number | undefined {
    const key = keyOf(ref)
    return this.takenServed(key, this.locate(ref)?.message.sendState)
      ? this.taken.get(key)
      : undefined
  }

  /** Whether the bytes can be had without a transfer: from the cache, or as a taken file. */
  isCached(ref: AttachmentRef): boolean {
    const key = keyOf(ref)
    return this.cached.has(key) || this.takenServed(key, this.locate(ref)?.message.sendState)
  }

  hasThumbnail(ref: AttachmentRef): boolean {
    return thumbnailed(this.holdsPicture(keyOf(ref)), this.locate(ref)?.attachment)
  }

  /** What a thumbnail is made from: the cached file, or the copy a send holds, sent or not. */
  private holdsPicture(key: string): boolean {
    return this.cached.has(key) || this.taken.has(key)
  }

  hasRendition(ref: AttachmentRef): boolean {
    const attachment = this.locate(ref)?.attachment
    return attachment !== undefined && this.rendered(ref, attachment)
  }

  private rendered(ref: AttachmentRef, attachment: Attachment): boolean {
    return this.renditions.has(keyOf(ref)) && renderable(this.cached.has(keyOf(ref)), attachment)
  }

  /**
   * libsession's `attachment_rendition` finding none: queues one, made a step later and announced,
   * for a picture it can make one of and has not been asked for yet.
   */
  askRendition(ref: AttachmentRef): void {
    const attachment = this.locate(ref)?.attachment
    const key = keyOf(ref)
    if (attachment === undefined || this.renditionsAsked.has(key)) return
    if (!renderable(this.cached.has(key), attachment)) return
    this.renditionsAsked.add(key)
    const make = () => {
      this.renditions.add(key)
      this.announceAttachment(ref.messageId)
    }
    if (this.world) this.world.schedule(1, make)
    else make()
  }

  /**
   * Emits messages with their attachments' availability stamped on.
   *
   * Every announcement goes through here, not only the paged answer: availability is derived
   * rather than stored, so a message emitted straight out of the map carries whatever it was
   * built with - which for a file already in the cache is a lie in the direction that matters.
   */
  private announce(type: 'messages-added' | 'messages-updated', messages: Message[]): void {
    const repliers = messages.flatMap((message) => this.repliers(message))
    if (type === 'messages-added') {
      this.emit({ type, messages: this.withAvailability(messages) })
      if (repliers.length > 0)
        this.emit({ type: 'messages-updated', messages: this.withAvailability(repliers) })
      return
    }
    // One report for the lot, as libsession makes: what a quote shows changed with its original.
    const all = [...new Map([...repliers, ...messages].map((m) => [m.id, m])).values()]
    this.emit({ type, messages: this.withAvailability(all) })
  }

  /** The stored replies to `original`, which libsession announces again whenever it changes. */
  private repliers(original: Message): Message[] {
    const stored = this.conversations.get(original.conversationId)?.messages ?? []
    return stored.filter((m) => m.id !== original.id && answers(m.replyTo, original))
  }

  /**
   * Says that what we hold of an attachment changed, which is a change to the message showing it.
   *
   * libsession reports this and nothing else would: filling the cache stores no field, so a
   * display reading `availability` would keep the answer it was given until something else
   * happened to the message.
   */
  private announceAttachment(messageId: number): void {
    for (const [, state] of this.conversations) {
      const message = state.messages.find((m) => m.id === messageId)
      if (message) {
        this.announce('messages-updated', [message])
        return
      }
    }
  }

  /**
   * The same messages as libsession reads them out: what each attachment's bytes are doing written
   * onto it, and a reply resolved against the original this account holds.
   *
   * The real bridge does this inside libsession, which owns the cache and the transfers; the fake
   * owns both here, so it stamps them on the way out. Everything a display needs arrives with the
   * message rather than beside it.
   */
  withAvailability(messages: Message[]): Message[] {
    return messages.map((message) => {
      const { replyTo, ...rest } = message
      return {
        ...rest,
        attachments: this.stamped(message),
        ...(replyTo === undefined ? {} : { replyTo: this.resolved(message, replyTo) }),
      }
    })
  }

  /** A reply with its original, where this account has one by that author at that time. */
  private resolved(message: Message, quote: FakeQuote): Reply {
    const stored = this.conversations.get(message.conversationId)?.messages ?? []
    const original = stored.find((m) => m.id !== message.id && answers(quote, m))
    const reference = { author: quote.author, timestamp: quote.timestamp }
    if (original === undefined) return reference
    const quoted: QuotedMessage = {
      id: original.id,
      outgoing: original.outgoing,
      body: original.body,
      attachments: this.stamped(original),
      ...(original.deleted === undefined ? {} : { deleted: original.deleted }),
    }
    return { ...reference, messageId: original.id, message: quoted }
  }

  private stamped(message: Message): Attachment[] {
    return message.attachments.map((attachment) => {
      const key = keyOf({ messageId: message.id, index: attachment.index })
      const running = this.transfers.get(key)?.progress
      const availability: AttachmentAvailability = running
        ? 'fetching'
        : this.cached.has(key) || this.takenServed(key, message.sendState)
          ? 'cached'
          : (this.verdicts.get(key) ?? 'absent')
      const thumbnail = thumbnailed(this.holdsPicture(key), attachment)
      // As the shim does: set exactly when there is a hash to draw.
      const { thumbhashAspect = FAKE_THUMBHASH_ASPECT, ...rest } = attachment
      return {
        ...rest,
        ...(attachment.hasThumbhash ? { thumbhashAspect } : {}),
        availability,
        hasThumbnail: thumbnail,
        thumbnailWidthPx: thumbnail ? FAKE_THUMBNAIL_WIDTH_PX : 0,
        thumbnailHeightPx: thumbnail ? FAKE_THUMBNAIL_EDGE_PX : 0,
        hasRendition: this.rendered({ messageId: message.id, index: attachment.index }, attachment),
        renditionRefused: refusesRendition(this.cached.has(key), attachment),
        fetchDoneBytes: running?.doneBytes ?? 0,
        fetchTotalBytes: running?.totalBytes ?? 0,
      }
    })
  }

  attachmentCacheLimit(): number | undefined {
    return this.cacheLimitBytes
  }

  setAttachmentCacheLimit(limitBytes?: number): void {
    this.cacheLimitBytes = limitBytes
  }

  /** The paths the network holds, which are none until it has connected. */
  networkPaths(): NetworkPaths {
    const now = this.world?.pathNow() ?? Date.now()
    return fakeNetworkPaths(
      this.connectedAtMs === null ? null : now - this.connectedAtMs,
      this.world?.pathTraffic ?? 'quiet',
      this.networkRouter,
    )
  }

  /**
   * libsession's five configs and a size for each, growing with what they hold. Not their real
   * sizes - the fake keeps no dumps - but in the same order, under the same names, and empty before
   * there is an account, which is what a caller can rely on.
   */
  configSizes(): ConfigSize[] {
    if (!this.haveAccount) return []
    const conversations = this.conversations.size
    // By name, as the bridge lists them.
    return [
      { name: 'contacts', bytes: 120 + 140 * conversations },
      { name: 'convo_info_volatile', bytes: 110 + 70 * conversations },
      { name: 'local', bytes: 90 },
      { name: 'user_groups', bytes: 110 },
      { name: 'user_profile', bytes: 180 + this.displayName.length },
    ]
  }

  /** What libsession would count: the encrypted size of every cached file. */
  attachmentCacheSize(): number {
    let usageBytes = 0
    for (const { messages } of this.conversations.values()) {
      for (const message of messages) {
        for (const attachment of message.attachments) {
          if (this.cached.has(keyOf({ messageId: message.id, index: attachment.index }))) {
            usageBytes += encryptedSize(attachment.sizeBytes ?? 0)
          }
        }
      }
    }
    return usageBytes
  }

  thumbnailEdge(): number {
    return this.storedThumbnailEdgePx ?? FAKE_THUMBNAIL_EDGE_PX
  }

  /** Remembered and clamped as libsession clamps it; the dev thumbnails stay the size they are. */
  setThumbnailEdge(edgePx?: number): void {
    this.storedThumbnailEdgePx =
      edgePx === undefined
        ? undefined
        : Math.min(Math.max(edgePx, THUMBNAIL_EDGE_MIN_PX), THUMBNAIL_EDGE_MAX_PX)
  }

  setAutoDownload(id: ConversationId, mode: AutoDownload): void {
    this.touch(id, { autoDownload: mode })
  }

  /**
   * Fetches an attachment into the cache, reporting as it goes.
   *
   * Cached already means no reports at all and an answer now - the case a progress indicator has
   * to survive. A transfer already running is joined rather than duplicated, as libsession joins
   * it, whether a download or an export started it: the joiner is told at once where it has got
   * to, and from then on every report reaches every consumer, so each step (and the end) arrives
   * once per consumer.
   */
  downloadAttachment(ref: AttachmentRef): Promise<void> {
    if (!this.locate(ref)) return refuseMissing(ref, this.hasMessage(ref.messageId))
    if (this.isCached(ref)) return Promise.resolve()
    return this.consume(ref, 'download')
  }

  /**
   * Writes an attachment out to a chosen path.
   *
   * A cached file is written from the cache with no report, there being no transfer to watch.
   * Otherwise the export is one more consumer of the file's transfer: it joins one already running
   * or starts one that fills the cache, and fails on a verdict as a download would.
   */
  exportAttachment(ref: AttachmentRef, destination: string, replace = false): Promise<string> {
    if (!this.locate(ref)) return refuseMissing(ref, this.hasMessage(ref.messageId))

    const fetched = this.isCached(ref) ? Promise.resolve() : this.consume(ref, 'export')
    return fetched.then(() => {
      const found = this.locate(ref)
      if (found) {
        const saved = found.message.attachments.map((a) =>
          a.index === ref.index ? { ...a, savedAtMs: this.world?.now() ?? Date.now() } : a,
        )
        this.updateMessage(found.conversationId, ref.messageId, { attachments: saved })
      }
      const landed = replace ? destination : this.unusedPath(destination)
      this.exported.add(landed)
      return landed
    })
  }

  /**
   * libsession's `name (1).ext`, `name (2).ext`... for a path already written. The fake has no
   * disk, so "already written" means exported to this session.
   */
  private unusedPath(destination: string): string {
    if (!this.exported.has(destination)) return destination
    const slash = Math.max(destination.lastIndexOf('/'), destination.lastIndexOf('\\'))
    const dot = destination.lastIndexOf('.')
    const split = dot > slash + 1 ? dot : destination.length
    const [stem, extension] = [destination.slice(0, split), destination.slice(split)]
    for (let n = 1; ; n += 1) {
      const candidate = `${stem} (${String(n)})${extension}`
      if (!this.exported.has(candidate)) return candidate
    }
  }

  /** Puts a consumer on the file's transfer, starting one if nothing is fetching it. */
  private consume(ref: AttachmentRef, kind: AttachmentTransfer): Promise<void> {
    const key = keyOf(ref)
    const running = this.transfers.get(key)
    const verdict = running ? undefined : this.verdicts.get(key)
    if (verdict !== undefined) return refuseVerdict(ref, verdict)

    return new Promise<void>((resolve, reject) => {
      const consumer: Consumer = { kind, resolve, reject }
      if (running) {
        running.consumers.push(consumer)
        this.tell(ref, consumer, running.progress)
      } else {
        this.start(ref, consumer)
      }
    })
  }

  /**
   * One transfer, reported on the world's clock.
   *
   * The first report is 0 of 0 - the size is not known until the server answers - and exactly one
   * report per consumer carries a result, which is the only thing that says it finished.
   */
  private start(ref: AttachmentRef, first: Consumer): void {
    const key = keyOf(ref)
    const sizeBytes = encryptedSize(this.locate(ref)?.attachment.sizeBytes ?? 0)
    const transfer: Transfer = {
      ref,
      progress: { doneBytes: 0, totalBytes: 0 },
      consumers: [first],
    }
    this.transfers.set(key, transfer)

    // Withdrawn, or lost to a restart, it is no longer the one registered, and says nothing more.
    const live = (): boolean => this.transfers.get(key) === transfer
    const step = (doneBytes: number, totalBytes: number): void => {
      if (!live()) return
      // Kept as well as reported, and as exactly what was reported: a page loading midway is told
      // where this is without waiting for the next report, and cannot tell the two routes apart.
      transfer.progress = { doneBytes, totalBytes }
      for (const consumer of transfer.consumers) this.tell(ref, consumer, transfer.progress)
    }
    // Ended while still registered, as libsession reports the end before it records the copy.
    const finish = (): void => {
      if (!live()) return
      const done = { doneBytes: sizeBytes, totalBytes: sizeBytes }
      for (const consumer of transfer.consumers) this.tell(ref, consumer, done, { ok: true })
      this.transfers.delete(key)
      this.cached.add(key)
      this.announceAttachment(ref.messageId)
      for (const consumer of transfer.consumers) consumer.resolve()
    }

    step(0, 0)
    // libsession announces `fetching` on every message showing the file once a transfer starts.
    this.announceAttachment(ref.messageId)

    const world = this.world
    if (!world) {
      finish()
      return
    }

    // Spread over a span that follows the size, with the same number of reports either way: the
    // bar moves in the same increments on any file, and a bigger one takes longer to get there.
    const span = transferTicks(sizeBytes)
    for (let i = 1; i < TRANSFER_STEPS; i += 1) {
      world.schedule((span * i) / TRANSFER_STEPS, () =>
        step(Math.round((sizeBytes * i) / TRANSFER_STEPS), sizeBytes),
      )
    }
    world.schedule(span, finish)
  }

  private tell(
    ref: AttachmentRef,
    consumer: Consumer,
    progress: TransferProgress,
    outcome?: AttachmentOutcome,
  ): void {
    this.emit({
      type: 'attachment-progress',
      transfer: consumer.kind,
      messageId: ref.messageId,
      index: ref.index,
      ...progress,
      ...(outcome === undefined ? {} : { outcome }),
    })
  }

  /**
   * Withdraws every transfer whose attachment is gone, as libsession does once a delete commits:
   * asked of what is stored rather than worked out by each caller, which delete in different ways.
   */
  private withdrawOrphanedTransfers(): void {
    for (const [key, transfer] of this.transfers) {
      if (this.locate(transfer.ref)) continue
      this.transfers.delete(key)
      for (const consumer of transfer.consumers) {
        this.tell(transfer.ref, consumer, transfer.progress, {
          ok: false,
          error: FILE_DOWNLOAD_CANCELLED,
        })
        consumer.reject(
          new SessionClientError('the attachment was deleted', FILE_DOWNLOAD_CANCELLED),
        )
      }
    }
  }

  setSendState(id: ConversationId, messageId: number, sendState: SendState): void {
    this.updateMessage(id, messageId, { sendState })
  }

  setSyncState(id: ConversationId, messageId: number, syncState: SendState): void {
    this.updateMessage(id, messageId, { syncState })
  }
}

/**
 * The accounts, and the loopback between them.
 *
 * Time is manual: `advance()` drives send-state transitions and delivery so a test never
 * waits on a real timer and never races one.
 */
export class FakeWorld {
  private readonly accounts = new Map<string, FakeAccount>()
  private queue: Array<{ at: number; run: () => void }> = []
  private clock = 1_700_000_000_000

  /**
   * The files a send can name, with their sizes. Unset, as behind an app, every path reads as a
   * file of unknown size: the platform's picker found it on a disk the fake cannot see.
   */
  private files: Map<string, number> | undefined

  constructor(private readonly stepMs = 10) {}

  /** Puts a file where a send can name it; from the first, only such files are readable. */
  writeFile(path: string, sizeBytes: number): void {
    this.files ??= new Map()
    this.files.set(path, sizeBytes)
  }

  removeFile(path: string): void {
    this.files?.delete(path)
  }

  /** Its size; null where nothing readable is, and undefined where the fake cannot know. */
  fileSize(path: string): number | null | undefined {
    if (this.files === undefined) return undefined
    return this.files.get(path) ?? null
  }

  now(): number {
    return this.clock
  }

  /** How much the accounts' paths carry; see `FakePathTraffic`. */
  pathTraffic: FakePathTraffic = 'quiet'

  /**
   * The clock the paths' traffic is timed by: the world's, unless an app sets the wall clock. An
   * app's dev loop only settles the world rather than running its clock, and a path screen with
   * no time passing has nothing to draw.
   */
  pathClock: (() => number) | undefined = undefined

  pathNow(): number {
    return this.pathClock?.() ?? this.clock
  }

  account(name: string, options?: Partial<FakeAccountOptions>): FakeAccount {
    const existing = this.accounts.get(name)
    if (existing) return existing
    const account = new FakeAccount({ displayName: options?.displayName ?? name, ...options })
    account.attachTo(this)
    this.accounts.set(name, account)
    return account
  }

  find(sessionId: string): FakeAccount | undefined {
    return [...this.accounts.values()].find((a) => a.sessionId === sessionId)
  }

  /** Runs `run` `steps` ticks from now, which is how a multi-step progression is staged. */
  schedule(steps: number, run: () => void): void {
    this.queue.push({ at: this.clock + this.stepMs * steps, run })
  }

  scheduleSend(sender: FakeAccount, conversationId: ConversationId, message: Message): void {
    this.queue.push({
      at: this.clock + this.stepMs,
      run: () => sender.setSendState(conversationId, message.id, 'sending'),
    })
    this.queue.push({
      at: this.clock + this.stepMs * 2,
      run: () => {
        sender.setSendState(conversationId, message.id, 'sent')
        const recipient = this.find(conversationId)
        // A note to self is one stored message, not a send and a delivery of it.
        if (recipient !== undefined && recipient !== sender)
          recipient.deliverFrom(
            sender,
            message.body,
            // The sender's own timestamp, which is what a reply names the message by.
            message.timestamp,
            received(message.attachments),
            message.replyTo,
          )
      },
    })

    // Behind the recipient's copy on purpose. The two are separate sends, and a sync still
    // pending after the message has arrived is the case a caller has to be able to represent -
    // a fake that settled both together would never produce it.
    this.queue.push({
      at: this.clock + this.stepMs * 3,
      run: () => sender.setSyncState(conversationId, message.id, 'sending'),
    })
    this.queue.push({
      at: this.clock + this.stepMs * 4,
      run: () => sender.setSyncState(conversationId, message.id, 'sent'),
    })
  }

  /** Runs everything scheduled up to `ms` from now. */
  advance(ms = this.stepMs * 2): void {
    this.clock += ms
    const due = this.queue.filter((item) => item.at <= this.clock)
    this.queue = this.queue.filter((item) => item.at > this.clock)
    for (const item of due) item.run()
  }

  /** Runs the queue out, however many rounds it takes. */
  settle(): void {
    let guard = 0
    while (this.queue.length > 0 && guard < SETTLE_ROUNDS) {
      this.advance()
      guard += 1
    }
  }
}
