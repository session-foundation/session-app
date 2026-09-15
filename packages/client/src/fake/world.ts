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

import type {
  AccountInfo,
  Attachment,
  AttachmentTransfer,
  AutoDownload,
  Conversation,
  ConversationId,
  Message,
  SendState,
  SessionEvent,
} from '@session/bridge-types'
import { ATTACHMENT_OK } from '@session/bridge-types'

export interface FakeAccountOptions {
  displayName: string
  sessionId?: string
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
 * percentage off `Attachment.size` disagrees with the fake, as it would with libsession.
 */
function encryptedSize(size: number): number {
  return 24 + size + Math.ceil(size / 32_768) * 17
}

/** How many reports a transfer makes between starting and finishing. */
const TRANSFER_STEPS = 4

/** libsession's rule: has attachments, and every one of them is an image. */
function galleryViewable(attachments: Attachment[]): boolean {
  return (
    attachments.length > 0 && attachments.every((a) => a.contentType?.startsWith('image/') === true)
  )
}

function wantedBy(mode: AutoDownload | undefined, attachment: Attachment): boolean {
  if (mode === 'all') return true
  if (mode === 'image-attachments') return attachment.contentType?.startsWith('image/') === true
  return false
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
  haveAccount = true
  networkAttached = false

  private readonly conversations = new Map<ConversationId, FakeConversationState>()
  private readonly listeners = new Set<(event: SessionEvent) => void>()
  private readonly prefs = new Map<string, string>()
  private world: FakeWorld | undefined
  /** Attachments whose bytes are in the cache, keyed `messageId:index`. */
  private readonly cached = new Set<string>()
  /** Downloads in flight, so a second request for one joins it rather than starting another. */
  private readonly downloading = new Map<string, Promise<void>>()
  /** Bumped by a restart: a transfer that was running does not survive the process. */
  private generation = 0

  constructor(options: FakeAccountOptions) {
    this.displayName = options.displayName
    this.sessionId = options.sessionId ?? `05${options.displayName.toLowerCase().padEnd(64, '0')}`
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
    return {
      haveAccount: this.haveAccount,
      sessionId: this.sessionId,
      displayName: this.displayName,
      networkAttached: this.networkAttached,
    }
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

    this.emit({ type: 'message-added', conversationId: id, message })
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
    this.emit({ type: 'message-updated', conversationId: id, message: updated })
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

  clearHistory(id: ConversationId): void {
    const state = this.conversations.get(id)
    if (!state) return
    this.conversations.set(id, { ...state, messages: [] })
    this.emit({ type: 'history-replaced', conversationId: id })
  }

  removeConversation(id: ConversationId): void {
    if (!this.conversations.delete(id)) return
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
    this.generation += 1
    this.downloading.clear()

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
      if (wantedBy(mode, attachment)) void this.downloadAttachment(message.id, attachment.index)
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
  locate(
    messageId: number,
    index: number,
  ): { conversationId: ConversationId; message: Message; attachment: Attachment } | undefined {
    for (const [conversationId, state] of this.conversations) {
      const message = state.messages.find((m) => m.id === messageId)
      const attachment = message?.attachments.find((a) => a.index === index)
      if (message && attachment) return { conversationId, message, attachment }
    }
    return undefined
  }

  isCached(messageId: number, index: number): boolean {
    return this.cached.has(`${messageId}:${index}`)
  }

  setAutoDownload(id: ConversationId, mode: AutoDownload): void {
    this.touch(id, { autoDownload: mode })
  }

  /**
   * Fetches an attachment into the cache, reporting as it goes.
   *
   * Cached already means no reports at all and an answer now - the case a progress indicator has
   * to survive. A fetch already running is joined rather than duplicated, which is why the
   * promise is remembered.
   */
  downloadAttachment(messageId: number, index: number): Promise<void> {
    const found = this.locate(messageId, index)
    if (!found) return Promise.reject(new Error(`No attachment ${messageId}:${index}`))
    const key = `${messageId}:${index}`
    if (this.cached.has(key)) return Promise.resolve()

    const joined = this.downloading.get(key)
    if (joined) return joined

    const running = this.transfer('download', found.conversationId, messageId, index).then(() => {
      this.cached.add(key)
      this.downloading.delete(key)
    })
    this.downloading.set(key, running)
    return running
  }

  /**
   * Writes an attachment somewhere, fetching it if the cache does not hold it.
   *
   * Never joined with a download of the same file: a save streams to its destination and leaves
   * the cache alone, so the two are separate transfers even for the same bytes.
   */
  saveAttachment(messageId: number, index: number, destination: string): Promise<string> {
    const found = this.locate(messageId, index)
    if (!found) return Promise.reject(new Error(`No attachment ${messageId}:${index}`))

    return this.transfer('save', found.conversationId, messageId, index).then(() => {
      const saved = found.message.attachments.map((a) =>
        a.index === index ? { ...a, savedAt: this.world?.now() ?? Date.now() } : a,
      )
      this.updateMessage(found.conversationId, messageId, { attachments: saved })
      return destination
    })
  }

  /**
   * One transfer, reported on the world's clock.
   *
   * The first report is 0 of 0 - the size is not known until the server answers - and exactly one
   * report carries a result, which is the only thing that says it finished.
   */
  private transfer(
    transfer: AttachmentTransfer,
    conversationId: ConversationId,
    messageId: number,
    index: number,
  ): Promise<void> {
    const found = this.locate(messageId, index)
    const total = encryptedSize(found?.attachment.size ?? 0)
    const world = this.world
    const generation = this.generation

    const report = (done: number, result?: number): void => {
      if (generation !== this.generation) return
      this.emit({
        type: 'attachment-progress',
        transfer,
        conversationId,
        messageId,
        index,
        done,
        total: done === 0 && result === undefined ? 0 : total,
        ...(result === undefined ? {} : { result }),
      })
    }

    report(0)
    if (!world) {
      report(total, ATTACHMENT_OK)
      return Promise.resolve()
    }

    return new Promise<void>((resolve, reject) => {
      for (let step = 1; step < TRANSFER_STEPS; step += 1) {
        world.schedule(step, () => report(Math.round((total * step) / TRANSFER_STEPS)))
      }
      world.schedule(TRANSFER_STEPS, () => {
        if (generation !== this.generation) {
          reject(new Error('the transfer did not survive the restart'))
          return
        }
        report(total, ATTACHMENT_OK)
        resolve()
      })
    })
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
