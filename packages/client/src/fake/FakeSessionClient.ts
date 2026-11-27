import { isHex64, isIpv4, isPort } from '@session/basic-types'

import { BridgeClosedError, CLIENT_CLOSED, SessionClientError } from '../errors'
import {
  MESSAGE_NOT_FOUND,
  type AccountInfo,
  type AttachmentRef,
  type AutoDownload,
  type ConfigSize,
  type Conversation,
  type ConversationId,
  type Deletion,
  type ExportAttachmentOptions,
  type Message,
  type MessageCursor,
  type NetworkPaths,
  type NetworkStatus,
  type NotificationContent,
  type NotificationSound,
  type PushService,
  type SendPlan,
  type SessionEvent,
} from '@session/bridge-types'

import type {
  ClientClosed,
  MessagePage,
  MessagePageOptions,
  NetworkAttachment,
  OutgoingMessage,
  SessionClient,
} from '../types'
import { FAKE_UPLOAD_LIMIT_BYTES } from './sendPlan'
import type { FakeAccount, FakeStagedFiles, FakeWorld, LocatedAttachment } from './world'

/** Why this network will not attach, or undefined when it will. */
function networkRefusal(config: NetworkAttachment): string | undefined {
  if (!['mainnet', 'testnet', 'devnet'].includes(config.netid))
    return `netid must be mainnet, testnet or devnet, not ${JSON.stringify(config.netid)}`

  // Session Router has no devnet, so the real bridge refuses the pair and so does this.
  if (config.netid === 'devnet' && config.router === 'session-router')
    return 'router must be onion-requests or direct on a devnet: Session Router has no devnet'

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
    if (!isHex64(config.fileServer.ed25519PubkeyHex))
      return 'fileServer.ed25519PubkeyHex must be 64 hex characters'
    if (!isPort(config.fileServer.port)) return 'fileServer.port must be a port'
  }

  return undefined
}

/** History's order: by timestamp, then id, so messages sharing a timestamp keep one order. */
function compareToCursor(message: Message, cursor: MessageCursor): number {
  return message.timestamp - cursor.timestamp || message.id - cursor.id
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
/** How old a push subscription may get before `setPushToken` renews it, as libsession's. */
const PUSH_RENEW_AFTER_MS = 24 * 60 * 60 * 1000

/** Every request's refusal but a reopen's, once the client is closed for the background. */
const CLOSED_IN_BACKGROUND = 'the client is closed while the app is in the background'

export class FakeSessionClient implements SessionClient {
  private closed = false
  /** Where `closeClient` is, as the real bridge tracks it: see `closeClient` in the protocol. */
  private background: 'open' | 'waiting' | 'closed' = 'open'
  /** This device's push subscription, as the push server holds it. */
  private pushSubscription: { service: PushService; token: string; atMs: number } | null = null
  /** As libsession's local settings default it: legacy iOS's Note. */
  private notificationSound: NotificationSound = 'note'
  /** Settles a close that is waiting, as a reopen does; set only while one waits. */
  private cancelClose: (() => void) | null = null
  /** The close the scheduled checks belong to, so a stale check cannot settle a later close. */
  private closeToken: object | null = null
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
    if (this.background === 'closed')
      throw new SessionClientError(CLOSED_IN_BACKGROUND, CLIENT_CLOSED)
  }

  async closeClient(waitMs: number, interruptMs: number): Promise<ClientClosed> {
    this.assertOpen()
    if (!(waitMs >= 0) || !(interruptMs >= 0))
      throw new SessionClientError('closeClient: waitMs and interruptMs must not be negative')
    if (this.background !== 'open')
      throw new SessionClientError('closeClient: the client is already closing')
    this.background = 'waiting'
    // On the world's clock, which is what moves a send along: checked each tick until nothing is
    // outbound, `waitMs` has passed or a reopen cancels it.
    const startedAt = this.world.now()
    const token = {}
    this.closeToken = token
    const cancelled = await new Promise<boolean>((resolve) => {
      this.cancelClose = () => {
        this.cancelClose = null
        resolve(true)
      }
      const check = () => {
        if (this.closeToken !== token || this.background !== 'waiting') return
        if (!this.account.outboundBusy() || this.world.now() - startedAt >= waitMs) {
          this.cancelClose = null
          resolve(false)
        } else this.world.schedule(1, check)
      }
      check()
    })
    const waitedMs = this.world.now() - startedAt
    const outboundBusy = this.account.outboundBusy()
    if (cancelled)
      return {
        closed: false,
        waitedMs,
        closeMs: 0,
        outboundBusy,
        interrupted: false,
        interruptedForReopen: false,
      }
    this.background = 'closed'
    // The fake runs no SQL that could still be going, so nothing is ever interrupted.
    return {
      closed: true,
      waitedMs,
      closeMs: 0,
      outboundBusy,
      interrupted: false,
      interruptedForReopen: false,
    }
  }

  setPushToken(service: PushService, token: string, force?: boolean): Promise<boolean> {
    this.assertOpen()
    if (token === '')
      return Promise.reject(new SessionClientError('setPushToken.token must not be empty'))
    if (!this.account.haveAccount || !this.account.networkAttached)
      return Promise.reject(new SessionClientError('no network or no account'))
    // As libsession decides: sent when there is none, when it differs, or once it is a day old.
    const now = this.world.now()
    const recorded = this.pushSubscription
    const unchanged =
      force !== true &&
      recorded !== null &&
      recorded.service === service &&
      recorded.token === token &&
      now - recorded.atMs < PUSH_RENEW_AFTER_MS
    if (unchanged) return Promise.resolve(false)
    this.pushSubscription = { service, token, atMs: now }
    return Promise.resolve(true)
  }

  /** The fake's world delivers messages rather than the fake fetching them: nothing to stop. */
  setReceiving(): Promise<void> {
    this.assertOpen()
    return Promise.resolve()
  }

  clearPushToken(): Promise<void> {
    this.assertOpen()
    this.pushSubscription = null
    return Promise.resolve()
  }

  getNotificationContent(): Promise<NotificationContent> {
    this.assertOpen()
    if (!this.account.haveAccount) return Promise.reject(new SessionClientError('no account'))
    return Promise.resolve(this.account.notificationContent)
  }

  setNotificationContent(content: NotificationContent): Promise<void> {
    this.assertOpen()
    if (!this.account.haveAccount) return Promise.reject(new SessionClientError('no account'))
    this.account.notificationContent = content
    return Promise.resolve()
  }

  /** Kept and unused: the fake writes no mention into a body. */
  setNotificationYou(_you: string): Promise<void> {
    this.assertOpen()
    return Promise.resolve()
  }

  getNotificationSound(): Promise<NotificationSound> {
    this.assertOpen()
    if (!this.account.haveAccount) return Promise.reject(new SessionClientError('no account'))
    return Promise.resolve(this.notificationSound)
  }

  setNotificationSound(sound: NotificationSound): Promise<void> {
    this.assertOpen()
    if (!this.account.haveAccount) return Promise.reject(new SessionClientError('no account'))
    this.notificationSound = sound
    return Promise.resolve()
  }

  reopenClient(): Promise<void> {
    if (this.closed) throw new BridgeClosedError()
    if (this.background === 'waiting') {
      this.background = 'open'
      this.cancelClose?.()
    } else if (this.background === 'closed') {
      this.background = 'open'
      this.account.reopen()
    }
    return Promise.resolve()
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
    this.account.goOnline()
    return Promise.resolve()
  }

  restoreAccount(
    from: { words: string[]; language?: string } | { hexSeed: string },
  ): Promise<void> {
    this.assertOpen()
    // The shim rejects a seed it cannot decode rather than guessing at one, so onboarding sees
    // the same refusal here as it will against libsession.
    if ('hexSeed' in from && !/^(?:[0-9a-fA-F]{32}){1,2}$/.test(from.hexSeed))
      return Promise.reject(new Error('hexSeed must be 16 or 32 bytes of hex'))
    // A phrase, though, is taken on trust: libsession refuses an unknown word by name and a
    // checksum that does not add up, and neither check can be made without its word list, which
    // is a megabyte of data this has no business carrying. So the refusal half of the recovery
    // screen is only reachable against the real bridge - noted rather than faked, because a
    // made-up rule here would predict nothing about the one that matters.
    this.account.haveAccount = true
    this.account.provisional = true
    this.account.goOnline()
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
    // Nothing may replace the Client while a close waits on it.
    if (this.background !== 'open')
      throw new SessionClientError(CLOSED_IN_BACKGROUND, CLIENT_CLOSED)
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

  getSeedHex(): Promise<string | null> {
    this.assertOpen()
    if (this.recoveryPasswordHidden()) return Promise.resolve(null)
    // The 16-byte form, as for every 13-word account: the length is the edge a QR code depends on.
    return Promise.resolve('0123456789abcdef0123456789abcdef')
  }

  hideRecoveryPassword(): Promise<void> {
    this.assertOpen()
    // As libsession refuses it: there is no recovery password to hide before the account exists,
    // and a flag set then would hide the one made next.
    if (!this.account.haveAccount) {
      return Promise.reject(
        new SessionClientError(
          'This Session account has no identity yet; call create_account() or restore_account() first',
        ),
      )
    }
    this.account.recoveryPasswordHidden = true
    return Promise.resolve()
  }

  getRecoveryPasswordHidden(): Promise<boolean> {
    this.assertOpen()
    return Promise.resolve(this.recoveryPasswordHidden())
  }

  private recoveryPasswordHidden(): boolean {
    return this.account.recoveryPasswordHidden
  }

  getSeedMnemonic(): Promise<string[] | null> {
    this.assertOpen()
    if (this.recoveryPasswordHidden()) return Promise.resolve(null)
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

    // Recorded either way and attached only with an account, as the bridge does.
    this.account.networkPlanned = true
    // libsession's default: Session Router where there is one, onion requests on a devnet.
    this.account.networkRouter =
      config.router ?? (config.netid === 'devnet' ? 'onion-requests' : 'session-router')
    this.account.goOnline()
    return Promise.resolve()
  }

  getNetworkStatus(): Promise<NetworkStatus> {
    this.assertOpen()
    return Promise.resolve(this.account.networkStatus)
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

  markRead(id: ConversationId, upTo?: number): Promise<void> {
    this.assertOpen()
    // The bridge carries the watermark as a whole number of milliseconds and refuses anything else.
    if (upTo !== undefined && !Number.isSafeInteger(upTo)) {
      return Promise.reject(
        new SessionClientError('markRead.upTo must be a whole number this bridge can carry'),
      )
    }
    this.account.markRead(id, upTo)
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

  getMessages(id: ConversationId, options: MessagePageOptions = {}): Promise<MessagePage> {
    this.assertOpen()
    const { limit = 50, before, after, around } = options
    // A limit is a page size, not a sentinel: there is no value meaning "all of it", because
    // history grows without bound.
    if (limit <= 0) {
      return Promise.reject(new SessionClientError('getMessages.limit must be greater than zero'))
    }
    if ([before, after, around].filter((position) => position !== undefined).length > 1) {
      return Promise.reject(
        new SessionClientError('getMessages takes one of before, after and around'),
      )
    }
    const stored = this.account.messages(id)
    // Deleted rows are dropped before the limit is applied, as libsession drops them in the
    // query: filtering a page after the fact would hand back short pages with nothing to say
    // that another page is warranted. The flags count the same rows.
    const visible = options.includeDeleted ? stored : stored.filter((m) => m.deleted === undefined)
    const page = (
      messages: Message[],
      hasNewer: boolean,
      hasOlder: boolean,
    ): Promise<MessagePage> =>
      Promise.resolve({ messages: this.account.withAvailability(messages), hasNewer, hasOlder })

    if (around !== undefined) {
      // Placed by the message even when it is deleted and so not in the page.
      const target = stored.find((m) => m.id === around)
      if (target === undefined) {
        return Promise.reject(
          new SessionClientError(`message ${String(around)} does not exist`, MESSAGE_NOT_FOUND),
        )
      }
      const newer = visible.filter((m) => compareToCursor(m, target) >= 0)
      const older = visible.filter((m) => compareToCursor(m, target) < 0).reverse()
      // Half older and half newer, an even limit's spare row newer; a short side gives its share
      // to the other.
      let wantOlder = Math.floor((limit - 1) / 2)
      let wantNewer = limit - wantOlder
      if (newer.length < wantNewer) wantOlder = limit - newer.length
      else if (older.length < wantOlder) wantNewer = limit - older.length
      wantOlder = Math.min(wantOlder, older.length)
      wantNewer = Math.min(wantNewer, newer.length)
      return page(
        [...older.slice(0, wantOlder).reverse(), ...newer.slice(0, wantNewer)],
        newer.length > wantNewer,
        older.length > wantOlder,
      )
    }

    if (after !== undefined) {
      const newer = visible.filter((m) => compareToCursor(m, after) > 0)
      return page(
        newer.slice(0, limit),
        newer.length > limit,
        visible.some((m) => compareToCursor(m, after) < 0),
      )
    }

    const older =
      before === undefined ? visible : visible.filter((m) => compareToCursor(m, before) < 0)
    return page(
      older.slice(Math.max(0, older.length - limit)),
      before !== undefined && visible.some((m) => compareToCursor(m, before) > 0),
      older.length > limit,
    )
  }

  downloadAttachment(messageId: number, index: number): Promise<void> {
    this.assertOpen()
    return this.account.downloadAttachment({ messageId, index })
  }

  exportAttachment(
    messageId: number,
    index: number,
    destination: string,
    options?: ExportAttachmentOptions,
  ): Promise<string> {
    this.assertOpen()
    return this.account.exportAttachment({ messageId, index }, destination, options?.replace)
  }

  /** Whether libsession would hold a thumbnail of this attachment: `Attachment.hasThumbnail`. */
  hasThumbnail(ref: AttachmentRef): boolean {
    return this.account.hasThumbnail(ref)
  }

  /** Whether libsession would hold a rendition of this attachment: `Attachment.hasRendition`. */
  hasRendition(ref: AttachmentRef): boolean {
    return this.account.hasRendition(ref)
  }

  /** Asks for a rendition, as a viewer's first fetch of one does: made a step later. */
  askRendition(ref: AttachmentRef): void {
    this.account.askRendition(ref)
  }

  /**
   * Fake-only: finds an attachment in memory, where paging every conversation would miss old ones.
   */
  locate(ref: AttachmentRef): LocatedAttachment | undefined {
    return this.account.locate(ref)
  }

  /** Fake-only: the size of a file a send took, while it is served and the world knows it. */
  takenSizeBytes(ref: AttachmentRef): number | undefined {
    return this.account.takenSizeBytes(ref)
  }

  /** Fake-only: whether an attachment's bytes have arrived, for a dev loader deciding to draw. */
  isCached(ref: AttachmentRef): boolean {
    return this.account.isCached(ref)
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

  setAttachmentCacheLimit(limitBytes?: number): Promise<void> {
    this.assertOpen()
    if (limitBytes !== undefined && limitBytes < 0) {
      return Promise.reject(
        new SessionClientError('setAttachmentCacheLimit.limitBytes must not be negative'),
      )
    }
    // Remembered but not enforced: the fake caches in memory and never evicts, so a limit has
    // nothing to bound. It is kept so a screen that reads one back sees what it wrote.
    this.account.setAttachmentCacheLimit(limitBytes)
    return Promise.resolve()
  }

  getAttachmentCacheSize(): Promise<number> {
    this.assertOpen()
    return Promise.resolve(this.account.attachmentCacheSize())
  }

  getThumbnailEdge(): Promise<number> {
    this.assertOpen()
    return Promise.resolve(this.account.thumbnailEdge())
  }

  setThumbnailEdge(edgePx?: number): Promise<void> {
    this.assertOpen()
    // The shim carries it as a uint32.
    if (
      edgePx !== undefined &&
      !(Number.isInteger(edgePx) && edgePx >= 0 && edgePx <= 0xffffffff)
    ) {
      return Promise.reject(
        new SessionClientError(
          'setThumbnailEdge.edgePx must be a whole number this bridge can carry',
        ),
      )
    }
    this.account.setThumbnailEdge(edgePx)
    return Promise.resolve()
  }

  getNetworkPaths(): Promise<NetworkPaths> {
    this.assertOpen()
    return Promise.resolve(this.account.networkPaths())
  }

  getConfigSizes(): Promise<ConfigSize[]> {
    this.assertOpen()
    return Promise.resolve(this.account.configSizes())
  }

  attachmentSendPlan(path: string, contentType?: string): Promise<SendPlan> {
    this.assertOpen()
    return this.account.sendPlan(path, contentType)
  }

  getAttachmentUploadLimit(): Promise<number> {
    this.assertOpen()
    return Promise.resolve(FAKE_UPLOAD_LIMIT_BYTES)
  }

  /** How the plan reads a file behind an app, whose disk the world cannot see. */
  readStagedFilesWith(files: FakeStagedFiles): void {
    this.account.readStagedFilesWith(files)
  }

  sendMessage(id: ConversationId, message: OutgoingMessage): Promise<number> {
    this.assertOpen()
    try {
      return Promise.resolve(
        this.account.send(id, message.body, message.replyTo, message.attachments),
      )
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
  }

  retrySend(messageId: number): Promise<boolean> {
    this.assertOpen()
    return Promise.resolve(this.account.resumeSend(messageId))
  }

  setGallery(messageId: number, gallery: boolean): Promise<boolean> {
    this.assertOpen()
    return Promise.resolve(this.account.setGallery(messageId, gallery))
  }

  deleteMessage(messageId: number, scope: Deletion): Promise<void> {
    this.assertOpen()
    this.account.deleteMessage(messageId, scope)
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
