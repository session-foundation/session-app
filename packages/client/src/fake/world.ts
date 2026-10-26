/**
 * A libsession that never touches a network.
 *
 * It exists so the UI, the store and the e2e suite can be built and run before the C++ shim
 * does, and so they can keep being tested afterwards without a devnet. It is not a stub:
 * it honours the parts of libsession's contract the app actually depends on -
 *
 *   - a send stores its row and reports it immediately, then moves through send states,
 *   - every change event carries the whole new state, never an id to go and fetch,
 *   - approving a request moves it between lists, and both lists are re-sent,
 *   - a restart leaves anything still in flight `interrupted`.
 *
 * @session/client-contract runs the same scenarios against this and against the real bridge, so
 * the two cannot drift apart quietly.
 */

import { isDisplayableImage } from '@session/basic-types'
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
  type Deletion,
  type Message,
  type SendState,
  type SessionEvent,
  type TransferProgress,
} from '@session/bridge-types'

import { SessionClientError } from '../errors'

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

/** The smallest a transfer can be, so a tiny file still reports a beginning and an end. */
const MIN_TRANSFER_TICKS = 2

/** How long this many encrypted bytes take, in the world's ticks. */
function transferTicks(bytes: number): number {
  return Math.max(Math.round((bytes / 1_000_000) * TICKS_PER_MEGABYTE), MIN_TRANSFER_TICKS)
}

/** libsession's rule: has attachments, and every one of them is a displayable image. */
function galleryViewable(attachments: Attachment[]): boolean {
  return attachments.length > 0 && attachments.every((a) => isDisplayableImage(a.contentType))
}

/** libsession's bounds on a thumbnail's side: 1024² at 4 bytes a pixel is 4 MiB decoded. */
const THUMBNAIL_EDGE_MIN_PX = 64
const THUMBNAIL_EDGE_MAX_PX = 1024
/** The side `pnpm fake-media:fetch` makes the dev thumbnails at, so what is served is this size. */
const FAKE_THUMBNAIL_EDGE_PX = 720

/** libsession makes one of every displayable picture it caches, and drops it on eviction. */
function thumbnailed(cached: boolean, contentType: string | undefined): boolean {
  return cached && isDisplayableImage(contentType)
}

function wantedBy(mode: AutoDownload | undefined, attachment: Attachment): boolean {
  if (mode === 'all') return true
  if (mode === 'image-attachments') return isDisplayableImage(attachment.contentType)
  return false
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
  messages: Message[]
  /**
   * Which incoming messages are still unread. Held beside the messages rather than on them
   * because libsession counts unread on the conversation and reports nothing per message -
   * this is the fake's own bookkeeping and it does not belong on the wire.
   */
  unread: Set<number>
}

export class FakeAccount {
  readonly sessionId: string
  displayName: string
  haveAccount: boolean
  networkAttached = false
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

  private readonly conversations = new Map<ConversationId, FakeConversationState>()
  private readonly listeners = new Set<(event: SessionEvent) => void>()
  private readonly prefs = new Map<string, string>()
  private world: FakeWorld | undefined
  /** Attachments whose bytes are in the cache, by `keyOf`. */
  private readonly cached = new Set<string>()
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

  /**
   * Back to a device with nothing on it, the way discarding an account leaves one.
   *
   * Everything the account accumulated goes: the identity, the conversations, the history, the
   * preferences. The session ID is kept because it is derived from the fixture's name and the
   * world wires peers up by it -- what matters for the behaviour under test is that
   * `haveAccount` is false, which is what `accountInfo` reports off.
   */
  discard(): void {
    this.haveAccount = false
    this.provisional = false
    this.profileArrivesAt = 0
    this.conversations.clear()
    this.prefs.clear()
  }

  /** Approved conversations, ordered the way the app shows them. */
  list(): Conversation[] {
    return this.ordered((c) => !c.request)
  }

  requests(): Conversation[] {
    return this.ordered((c) => c.request)
  }

  private ordered(predicate: (c: Conversation) => boolean): Conversation[] {
    return [...this.conversations.values()]
      .map((state) => state.conversation)
      .filter(predicate)
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
   * The list a row moved in, when it moved rather than merely changed.
   *
   * A conversation's place is decided by `lastActivity` and `priority`, so a subscriber told only
   * that the row changed would not know it had moved - and could not work it out without
   * reimplementing a sort that is not even the same for both lists. But most of what changes a
   * conversation leaves it exactly where it was: a read receipt, a nickname, an expiry. Announcing
   * there is a list rebuild to say nothing.
   *
   * **One list, not both.** A conversation is in exactly one - libsession's two queries are strict
   * complements, `priority >= 0 AND [NOT] IS_REQUEST` - so replacing both says one true thing and
   * one false one, and pays for a full rebuild to do it. The exception is a row that crossed
   * between them, which is the only case where both genuinely changed: one lost it, the other
   * gained it.
   */
  private announceIfMoved(before: Conversation | undefined, after: Conversation): void {
    const crossed = before !== undefined && before.request !== after.request
    const moved =
      before === undefined ||
      crossed ||
      before.priority !== after.priority ||
      before.lastActivity !== after.lastActivity
    if (!moved) return

    if (crossed || !after.request) {
      this.emit({ type: 'conversation-list-replaced', conversations: this.list() })
    }
    if (crossed || after.request) {
      this.emit({ type: 'request-list-replaced', conversations: this.requests() })
    }
  }

  /** Adds a conversation and announces it, the way libsession would on first contact. */
  upsertConversation(conversation: Conversation, { announce = true } = {}): Conversation {
    const existing = this.conversations.get(conversation.id)
    const state: FakeConversationState = existing
      ? { conversation, messages: existing.messages, unread: existing.unread }
      : { conversation, messages: [], unread: new Set() }
    this.conversations.set(conversation.id, state)

    if (!announce) return conversation

    this.emit({
      type: existing ? 'conversation-updated' : 'conversation-added',
      conversation,
    })
    // Approval arrives as an update rather than a remove plus an add, so a display that
    // keeps two lists needs both of them re-sent to move the row across.
    this.announceIfMoved(existing?.conversation, conversation)
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
    this.emit({ type: 'conversation-updated', conversation })
    this.announceIfMoved(state.conversation, conversation)
    return conversation
  }

  addMessage(id: ConversationId, message: Message): Message {
    const state = this.conversations.get(id)
    if (!state) throw new Error(`No conversation ${id}`)
    if (!message.outgoing) state.unread.add(message.id)
    for (const attachment of message.attachments) {
      if (isVerdict(attachment.availability))
        this.verdicts.set(
          keyOf({ messageId: message.id, index: attachment.index }),
          attachment.availability,
        )
    }
    state.messages.push(message)
    state.messages.sort((a, b) => a.timestamp - b.timestamp || a.id - b.id)

    const unreadCount = state.messages.filter((m) => state.unread.has(m.id) && !m.outgoing).length
    const conversation: Conversation = {
      ...state.conversation,
      lastActivity: message.timestamp,
      snippet: message.body,
      unreadCount,
    }
    this.conversations.set(id, { ...state, conversation })

    // A batch of one: the fake delivers a message at a time, which is a batch the real
    // bridge could also produce. A handler that only works on larger ones is broken.
    this.announce('messages-added', [message])
    this.emit({ type: 'conversation-updated', conversation })
    // Always moves: the message it just stored is the newest activity in the conversation.
    this.announceIfMoved(state.conversation, conversation)
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

  markRead(id: ConversationId): void {
    const state = this.conversations.get(id)
    if (!state) return
    state.unread.clear()
    const conversation: Conversation = {
      ...state.conversation,
      unreadCount: 0,
      markedUnread: false,
    }
    this.conversations.set(id, { ...state, conversation })
    this.emit({ type: 'conversation-updated', conversation })
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
    this.emit({ type: 'conversation-removed', conversationId: id })
    this.emit({ type: 'conversation-list-replaced', conversations: this.list() })
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
      }
    }
  }

  deliverFrom(
    sender: FakeAccount,
    body: string,
    timestamp: number,
    attachments: Attachment[] = [],
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

  send(id: ConversationId, body: string, replyTo?: number): number {
    const now = this.world?.now() ?? Date.now()
    const message: Message = {
      id: nextId(),
      conversationId: id,
      author: this.sessionId,
      timestamp: now,
      body,
      outgoing: true,
      // Stored and shown before it is sent - which is why the app needs no optimistic copy.
      sendState: 'pending',
      // Sending an attachment is not in the protocol, so an outgoing message never has one.
      attachments: [],
      galleryViewable: false,
      // A second send, to our own swarm, so our other devices see it. Left unset on an incoming
      // message, which is why `deliverFrom` does not set one.
      syncState: 'pending',
      ...(replyTo === undefined
        ? {}
        : { replyTo: { author: this.sessionId, timestamp: now, messageId: replyTo } }),
    }
    this.addMessage(id, message)
    this.world?.scheduleSend(this, id, message)
    return message.id
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

  isCached(ref: AttachmentRef): boolean {
    return this.cached.has(keyOf(ref))
  }

  hasThumbnail(ref: AttachmentRef): boolean {
    return thumbnailed(this.isCached(ref), this.locate(ref)?.attachment.contentType)
  }

  /**
   * Emits messages with their attachments' availability stamped on.
   *
   * Every announcement goes through here, not only the paged answer: availability is derived
   * rather than stored, so a message emitted straight out of the map carries whatever it was
   * built with - which for a file already in the cache is a lie in the direction that matters.
   */
  private announce(type: 'messages-added' | 'messages-updated', messages: Message[]): void {
    this.emit({ type, messages: this.withAvailability(messages) })
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
   * The same messages, with what each attachment's bytes are doing written onto it.
   *
   * The real bridge does this inside libsession, which owns the cache and the transfers; the fake
   * owns both here, so it stamps them on the way out. Everything a display needs arrives with the
   * message rather than beside it.
   */
  withAvailability(messages: Message[]): Message[] {
    return messages.map((message) => ({
      ...message,
      attachments: message.attachments.map((attachment) => {
        const key = keyOf({ messageId: message.id, index: attachment.index })
        const running = this.transfers.get(key)?.progress
        const availability: AttachmentAvailability = running
          ? 'fetching'
          : this.cached.has(key)
            ? 'cached'
            : (this.verdicts.get(key) ?? 'absent')
        return {
          ...attachment,
          availability,
          hasThumbnail: thumbnailed(availability === 'cached', attachment.contentType),
          fetchDoneBytes: running?.doneBytes ?? 0,
          fetchTotalBytes: running?.totalBytes ?? 0,
        }
      }),
    }))
  }

  attachmentCacheLimit(): number | undefined {
    return this.cacheLimitBytes
  }

  setAttachmentCacheLimit(limitBytes?: number): void {
    this.cacheLimitBytes = limitBytes
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
          if (this.isCached({ messageId: message.id, index: attachment.index })) {
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
    if (this.cached.has(keyOf(ref))) return Promise.resolve()
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

    const fetched = this.cached.has(keyOf(ref)) ? Promise.resolve() : this.consume(ref, 'export')
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

  constructor(private readonly stepMs = 10) {}

  now(): number {
    return this.clock
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
        if (recipient) recipient.deliverFrom(sender, message.body, this.clock)
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
    while (this.queue.length > 0 && guard < 100) {
      this.advance()
      guard += 1
    }
  }
}
