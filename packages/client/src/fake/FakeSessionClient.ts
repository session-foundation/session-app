import { isHex64, isIpv4, isPort } from '@session/basic-types'

import { BridgeClosedError, SessionClientError } from '../errors'
import type {
  AccountInfo,
  AutoDownload,
  Conversation,
  ConversationId,
  Deletion,
  Message,
  SessionEvent,
} from '@session/bridge-types'

import type { NetworkAttachment, OutgoingMessage, SessionClient } from '../types'
import type { FakeAccount, FakeWorld } from './world'

/** Why this network will not attach, or undefined when it will. */
function networkRefusal(config: NetworkAttachment): string | undefined {
  if (!['mainnet', 'testnet', 'devnet'].includes(config.netid))
    return `netid must be mainnet, testnet or devnet, not ${JSON.stringify(config.netid)}`

  // Session Router has no devnet, so the real bridge refuses the pair and so does this.
  if (config.netid === 'devnet' && config.router === 'session-router')
    return 'router must be onion-requests on a devnet: Session Router has no devnet'

  if (config.netid === 'devnet') {
    const seeds = config.seedNodes ?? []
    if (seeds.length === 0)
      return 'devnet needs at least one seed node: libsession has built-in seeds for mainnet and testnet only'

    for (const [index, seed] of seeds.entries()) {
      const at = `seedNodes[${index}].`
      if (!isHex64(seed.ed25519PubkeyHex)) return `${at}ed25519PubkeyHex must be 64 hex characters`
      // libsession dials the address itself and resolves no host names, so a name is a
      // configuration error rather than a lookup that happens later.
      if (!isIpv4(seed.ip)) return `${at}ip must be an IPv4 address, not ${JSON.stringify(seed.ip)}`
      if (!isPort(seed.httpsPort)) return `${at}httpsPort must be a port`
      if (!isPort(seed.omqPort)) return `${at}omqPort must be a port`
    }
  }

  if (config.fileServer) {
    if (config.fileServer.host.length === 0) return 'fileServer.host must not be empty'
    if (!isHex64(config.fileServer.x25519PubkeyHex))
      return 'fileServer.x25519PubkeyHex must be 64 hex characters'
    if (!isPort(config.fileServer.port)) return 'fileServer.port must be a port'
  }

  return undefined
}

/**
 * How long a restored profile takes to turn up in the fake.
 *
 * Short enough not to be a wait anybody sits through, long enough that the screen covering it is
 * actually drawn. The real one is a swarm round trip and the app gives it fifteen seconds.
 */
const FAKE_PROFILE_DELAY_MS = 2500

/**
 * The fake behind the same interface the real bridge implements.
 *
 * Everything here is synchronous underneath; the promises exist because the interface has
 * them. Delivery and send-state transitions only happen when the world's clock is advanced,
 * so a test decides when time passes.
 */
export class FakeSessionClient implements SessionClient {
  private closed = false
  private readonly unsubscribes: Array<() => void> = []

  constructor(
    private readonly account: FakeAccount,
    private readonly world: FakeWorld,
  ) {}

  onEvent(listener: (event: SessionEvent) => void): () => void {
    const unsubscribe = this.account.subscribe(listener)
    this.unsubscribes.push(unsubscribe)
    return unsubscribe
  }

  private assertOpen(): void {
    if (this.closed) throw new BridgeClosedError()
  }

  getAccountInfo(): Promise<AccountInfo> {
    this.assertOpen()
    return Promise.resolve(this.account.accountInfo())
  }

  createAccount(): Promise<void> {
    this.assertOpen()
    this.account.haveAccount = true
    // Provisional until `keepAccount` says otherwise. See FakeAccount.provisional.
    this.account.provisional = true
    return Promise.resolve()
  }

  restoreAccount(
    from: { words: string[]; language?: string } | { hexSeed: string },
  ): Promise<void> {
    this.assertOpen()
    // The shim rejects a seed it cannot decode rather than guessing at one, so onboarding sees
    // the same refusal here as it will against libsession.
    if ('hexSeed' in from && !/^[0-9a-fA-F]{64}$/.test(from.hexSeed))
      return Promise.reject(new Error('hexSeed must be 32 bytes of hex'))
    // A phrase, though, is taken on trust: libsession refuses an unknown word by name and a
    // checksum that does not add up, and neither check can be made without its word list, which
    // is a megabyte of data this has no business carrying. So the refusal half of the recovery
    // screen is only reachable against the real bridge - noted rather than faked, because a
    // made-up rule here would predict nothing about the one that matters.
    this.account.haveAccount = true
    this.account.provisional = true
    // The account comes back before its profile does: libsession has the identity the moment the
    // seed decodes, and the display name only once the swarm answers. The fake said both at once,
    // which made the wait that exists to cover that gap finish before it was drawn.
    this.account.profileArrivesAt = Date.now() + FAKE_PROFILE_DELAY_MS
    return Promise.resolve()
  }

  checkRecoveryPhrase(words: string[]): Promise<void> {
    this.assertOpen()
    // The word count is the one rule the fake can apply honestly: libsession takes 12, 13, 24 or
    // 25 words and refuses anything else by length alone, before it looks a single word up. The
    // rest of what it checks needs the word lists, so a phrase of the right length is accepted
    // here whatever it says - see restoreAccount.
    if (![12, 13, 24, 25].includes(words.length))
      return Promise.reject(new Error(`a recovery phrase is 13 words, not ${words.length}`))
    return Promise.resolve()
  }

  discardAccount(): Promise<void> {
    this.assertOpen()
    // The real bridge deletes the database and opens a new one, so what survives is nothing the
    // account put there. Modelled as the account being emptied rather than the client being
    // replaced, because a caller keeps the same client across a discard either way.
    this.account.discard()
    return Promise.resolve()
  }

  keepAccount(): Promise<void> {
    this.assertOpen()
    this.account.provisional = false
    return Promise.resolve()
  }

  getSeedMnemonic(): Promise<string[]> {
    this.assertOpen()
    // libsession owns the real word list; the shape is what onboarding is written against.
    return Promise.resolve(
      'letters mumble ordeal jaded womanly framed jailed sifting january nurse gutter estate jaded'.split(
        ' ',
      ),
    )
  }

  setDisplayName(name: string): Promise<void> {
    this.assertOpen()
    this.account.displayName = name
    return Promise.resolve()
  }

  /**
   * Refuses what the shim refuses, and for the same reasons: these are the edges a caller trips
   * over, and a fake that accepts a network libsession would not predicts nothing.
   */
  attachNetwork(config: NetworkAttachment): Promise<void> {
    this.assertOpen()

    const refusal = networkRefusal(config)
    if (refusal !== undefined) return Promise.reject(new SessionClientError(refusal))

    this.account.networkAttached = true
    return Promise.resolve()
  }

  pollOnce(): Promise<void> {
    this.assertOpen()
    this.world.settle()
    return Promise.resolve()
  }

  /**
   * Refuses on the one condition a caller can trip over, and reports success otherwise.
   *
   * There is no pool to fill here, so what the fake mirrors is the contract rather than the work:
   * an account means the client's own network is the one doing this, and warming beside it is the
   * cost it exists to avoid.
   */
  warmNetworkCache(): Promise<boolean> {
    this.assertOpen()
    return Promise.resolve(!this.account.haveAccount)
  }

  getConversations(): Promise<Conversation[]> {
    this.assertOpen()
    return Promise.resolve(this.account.list())
  }

  getMessageRequests(): Promise<Conversation[]> {
    this.assertOpen()
    return Promise.resolve(this.account.requests())
  }

  getConversation(id: ConversationId): Promise<Conversation> {
    this.assertOpen()
    const conversation = this.account.get(id)
    if (!conversation) return Promise.reject(new SessionClientError(`No such conversation: ${id}`))
    return Promise.resolve(conversation)
  }

  openDm(sessionId: string): Promise<ConversationId> {
    this.assertOpen()
    const existing = this.account.get(sessionId)
    if (existing) return Promise.resolve(existing.id)

    const peer = this.world.find(sessionId)
    this.account.upsertConversation({
      id: sessionId,
      kind: 'dm',
      displayName: peer?.displayName ?? sessionId.slice(0, 8),
      lastActivity: this.world.now(),
      priority: 0,
      unreadCount: 0,
      markedUnread: false,
      request: false,
      awaitingApproval: false,
      noteToSelf: sessionId === this.account.sessionId,
      blocked: false,
    })
    return Promise.resolve(sessionId)
  }

  markRead(id: ConversationId): Promise<void> {
    this.assertOpen()
    this.account.markRead(id)
    return Promise.resolve()
  }

  setPollInterval(intervalMs: number): Promise<void> {
    this.assertOpen()
    // The fake has no ticker to retune; refusing the same values the real one refuses is the
    // whole of what it owes a caller here.
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      return Promise.reject(
        new SessionClientError('setPollInterval.intervalMs must be greater than zero'),
      )
    }
    return Promise.resolve()
  }

  setBlocked(id: ConversationId, blocked: boolean): Promise<void> {
    this.assertOpen()
    this.account.touch(id, { blocked })
    return Promise.resolve()
  }

  setNickname(id: ConversationId, nickname?: string): Promise<void> {
    this.assertOpen()
    const current = this.account.get(id)
    if (!current) return Promise.resolve()
    // Our own account is not a contact, so there is no entry to hold a nickname.
    if (current.noteToSelf) {
      return Promise.reject(
        new SessionClientError('setNickname: not applicable to your own account'),
      )
    }
    if (nickname === undefined) {
      const { nickname: _cleared, ...withoutNickname } = current
      this.account.replace(withoutNickname)
    } else {
      this.account.replace({ ...current, nickname })
    }
    return Promise.resolve()
  }

  setPriority(id: ConversationId, priority: number): Promise<void> {
    this.assertOpen()
    this.account.touch(id, { priority })
    return Promise.resolve()
  }

  approveConversation(id: ConversationId): Promise<void> {
    this.assertOpen()
    const conversation = this.account.get(id)
    if (!conversation) return Promise.resolve()
    // Goes through upsert so both lists are re-sent: the row moves, it is not re-added.
    this.account.upsertConversation({ ...conversation, request: false, awaitingApproval: false })
    return Promise.resolve()
  }

  deleteConversation(id: ConversationId): Promise<void> {
    this.assertOpen()
    this.account.removeConversation(id)
    return Promise.resolve()
  }

  getMessages(
    id: ConversationId,
    options?: {
      limit?: number
      before?: { timestamp: number; id: number }
      includeDeleted?: boolean
    },
  ): Promise<{ messages: Message[] }> {
    this.assertOpen()
    // A limit is a page size, not a sentinel: there is no value meaning "all of it", because
    // history grows without bound.
    if (options?.limit !== undefined && options.limit <= 0) {
      return Promise.reject(new SessionClientError('getMessages.limit must be greater than zero'))
    }
    // Deleted rows are dropped before the limit is applied, as libsession drops them in the
    // query: filtering a page after the fact would hand back short pages with nothing to say
    // that another page is warranted.
    const all = options?.includeDeleted
      ? this.account.messages(id)
      : this.account.messages(id).filter((m) => m.deleted === undefined)
    const before = options?.before
    const older = before
      ? all.filter(
          (m) =>
            m.timestamp < before.timestamp ||
            (m.timestamp === before.timestamp && m.id < before.id),
        )
      : all
    const limit = options?.limit ?? 50
    // Newest-first paging, returned oldest-first so a transcript can render it directly.
    const messages = older.slice(Math.max(0, older.length - limit))
    return Promise.resolve({ messages: this.account.withAvailability(messages) })
  }

  downloadAttachment(messageId: number, index: number): Promise<void> {
    this.assertOpen()
    if (!this.account.locate(messageId, index)) {
      return Promise.reject(new SessionClientError(`No attachment ${messageId}:${index}`))
    }
    return this.account.downloadAttachment(messageId, index)
  }

  saveAttachment(messageId: number, index: number, destination: string): Promise<string> {
    this.assertOpen()
    if (!this.account.locate(messageId, index)) {
      return Promise.reject(new SessionClientError(`No attachment ${messageId}:${index}`))
    }
    return this.account.saveAttachment(messageId, index, destination)
  }

  setAutoDownload(id: ConversationId, mode: AutoDownload): Promise<void> {
    this.assertOpen()
    this.account.setAutoDownload(id, mode)
    return Promise.resolve()
  }

  getCacheDir(): Promise<string> {
    this.assertOpen()
    // The fake writes nothing to disk, and says so rather than naming a directory that is not
    // there: a screen offering to reveal one has to handle the empty case anyway.
    return Promise.resolve('')
  }

  getAttachmentCacheLimit(): Promise<number | undefined> {
    this.assertOpen()
    return Promise.resolve(this.account.attachmentCacheLimit())
  }

  setAttachmentCacheLimit(bytes?: number): Promise<void> {
    this.assertOpen()
    // Remembered but not enforced: the fake caches in memory and never evicts, so a limit has
    // nothing to bound. It is kept so a screen that reads one back sees what it wrote.
    this.account.setAttachmentCacheLimit(bytes)
    return Promise.resolve()
  }

  sendMessage(id: ConversationId, message: OutgoingMessage): Promise<number> {
    this.assertOpen()
    return Promise.resolve(this.account.send(id, message.body, message.replyTo))
  }

  retrySend(): Promise<boolean> {
    this.assertOpen()
    return Promise.resolve(true)
  }

  deleteMessage(messageId: number, scope: Deletion): Promise<void> {
    this.assertOpen()
    for (const conversation of [...this.account.list(), ...this.account.requests()]) {
      const found = this.account.messages(conversation.id).find((m) => m.id === messageId)
      if (found) {
        this.account.updateMessage(conversation.id, messageId, { deleted: scope, body: '' })
        break
      }
    }
    return Promise.resolve()
  }

  getPref(key: string): Promise<string | undefined> {
    this.assertOpen()
    return Promise.resolve(this.account.getPref(key))
  }

  setPref(key: string, value: string): Promise<void> {
    this.assertOpen()
    this.account.setPref(key, value)
    return Promise.resolve()
  }

  close(): void {
    this.closed = true
    for (const unsubscribe of this.unsubscribes) unsubscribe()
    this.unsubscribes.length = 0
  }

  /**
   * Stops this client and opens a new one on the same data, the way relaunching the app
   * would. Anything still in flight comes back interrupted.
   */
  restart(): FakeSessionClient {
    this.close()
    this.account.restart()
    return new FakeSessionClient(this.account, this.world)
  }
}
