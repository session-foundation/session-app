/**
 * What every SessionClient must do, whoever implements it.
 *
 * The fake runs this on every PR. The real addon runs the same scenarios offline, feeding
 * inbound messages through libsession's own test path rather than a network. When the two
 * disagree, one of them is wrong and the suite says which behaviour was expected - which is
 * the whole point: a fake nobody checks is a fake that quietly stops predicting anything.
 *
 * Written as a function of a harness so it can be handed either implementation.
 */

import {
  ATTACHMENT_NOT_FOUND,
  FILE_DOWNLOAD_CANCELLED,
  FILE_NOT_FOUND,
  MESSAGE_NOT_FOUND,
  SessionClientError,
  type AttachmentAvailability,
  type AttachmentTransfer,
  type Conversation,
  type IncomingNotification,
  type ListPlacement,
  type MediaSource,
  type Message,
  type MessagePage,
  type SessionClient,
  type SessionEvent,
} from '@session/client'

import { recoveryHex, recoveryWords } from './seed'

export interface ContractHarness {
  /** Two clients that already know each other, with no history and no attachments. */
  friends(): Promise<{
    alice: SessionClient
    bob: SessionClient
    aliceId: string
    bobId: string
    /** Lets whatever is in flight finish: a manual clock, or a real poll. */
    settle: () => Promise<void>
    /** Writes a file of `sizeBytes` bytes for a send to name, and answers its path. */
    writeFile: (name: string, sizeBytes: number) => Promise<string>
    /** Deletes a file `writeFile` wrote. */
    removeFile: (path: string) => Promise<void>
    /** Writes a JPEG libsession decodes, for a send to name, and answers its path. */
    writePicture: (name: string, widthPx: number, heightPx: number) => Promise<string>
    /** Alice's media source. */
    aliceMedia: MediaSource
  }>
  /** A pair where bob has written to alice but alice has not approved. */
  strangers(): Promise<{
    alice: SessionClient
    bob: SessionClient
    bobId: string
    settle: () => Promise<void>
  }>
  /**
   * A client holding one incoming message with one attachment nobody has fetched.
   *
   * Its own entry rather than a flag on `friends`, because an implementation that cannot produce
   * an incoming attachment cannot produce one for any scenario, and skipping the scenarios is
   * then the honest answer rather than a fixture that quietly has none.
   *
   * `expired` asks for one the file server no longer holds. `pastPixelLimits` asks for a JPEG
   * past libsession's decode limits, which it caches but makes no thumbnail or rendition of.
   */
  withAttachment(options?: { expired?: boolean; pastPixelLimits?: boolean }): Promise<{
    client: SessionClient
    conversationId: string
    messageId: number
    index: number
    settle: () => Promise<void>
    /** Delivers another incoming message holding one image, and answers its id. */
    receiveImage: () => Promise<number>
  }>
  /**
   * A client a friend can send forged attachments to. `receive` delivers one incoming message
   * with one attachment of each content type given, and answers it as the client lists it.
   *
   * The attachments point at nothing, so only what the client says about them can be asked.
   */
  receivesAttachments(): Promise<{
    /** The receiving client, which `restart` accepts. */
    client: SessionClient
    /** The conversation the forged messages land in. */
    conversationId: string
    receive: (contentTypes: readonly string[]) => Promise<Message>
  }>
  /**
   * A client a friend's messages are delivered to one at a time, dated and quoting as told, so a
   * scenario decides what arrives in which order. `receive` answers once the client holds it.
   */
  receivesMessages(): Promise<{
    client: SessionClient
    /** The conversation they land in, which is also the account they come from. */
    conversationId: string
    receive: (message: {
      body: string
      timestamp: number
      /** The message it answers, as the wire names one: whether the client has it or not. */
      replyTo?: { author: string; timestamp: number }
    }) => Promise<void>
  }>
  /** Stops and restarts a client against the same data. */
  restart(client: SessionClient): Promise<SessionClient>
  /**
   * One client with no account at all: where onboarding starts.
   *
   * `phrase` is a recovery phrase this implementation accepts. Supplied by the harness rather
   * than written into the suite, because only the implementation knows what it considers a real
   * one - the fake has a canonical phrase and libsession has a word list.
   */
  newcomer(): Promise<{ client: SessionClient; phrase: string[] }>
  /**
   * One client whose database would not open -- written under another key, or otherwise
   * unreadable. How it is made unreadable is the implementation's business; what the suite holds
   * is how the client behaves once it is.
   */
  unopenable(): Promise<SessionClient>
}

type Runner = (name: string, body: () => Promise<void> | void) => void

export type TestFns = {
  describe: (name: string, body: () => void) => void
  it: Runner & { skip: Runner }
  expect: <T>(actual: T) => {
    // Declared as properties rather than methods so that pulling one off the matcher is
    // not read as an unbound `this`.
    toBe: (expected: unknown) => void
    toEqual: (expected: unknown) => void
    toBeDefined: () => void
    toBeUndefined: () => void
    toContain: (expected: unknown) => void
    toBeGreaterThan: (expected: number) => void
  }
}

/** Whatever a call failed with, whether it threw or rejected. */
async function failure(call: () => Promise<unknown>): Promise<unknown> {
  try {
    await call()
    return undefined
  } catch (error) {
    return error
  }
}

function collect(client: SessionClient): { events: SessionEvent[]; stop: () => void } {
  const events: SessionEvent[] = []
  const stop = client.onEvent((event) => events.push(event))
  return { events, stop }
}

/** Waits, a bounded while, for `ready`: an event decided off the bridge's thread arrives later. */
async function eventually(ready: () => boolean): Promise<void> {
  for (let round = 0; round < 100 && !ready(); round += 1)
    await new Promise((resolve) => setTimeout(resolve, 20))
}

function notificationsOf(events: SessionEvent[]): IncomingNotification[] {
  return events.flatMap((e) => (e.type === 'notification' ? [e.notification] : []))
}

function staleOf(events: SessionEvent[]): string[] {
  return events.flatMap((e) => (e.type === 'notifications-stale' ? e.ids : []))
}

/**
 * Every message that arrived or changed, flattened out of the batches that carried it.
 *
 * How many batches a delivery is split into is the implementation's business - libsession
 * coalesces and the fake does not - so a scenario asserts on the messages rather than on the
 * shape of the stream that brought them.
 */
function messagesOf(
  events: SessionEvent[],
  type: 'messages-added' | 'messages-updated',
): Message[] {
  return events.flatMap((e) => (e.type === type ? e.messages : []))
}

/** Where each change to one conversation placed it, in the order they arrived. */
function placementsOf(events: SessionEvent[], id: string): ListPlacement[] {
  return events.flatMap((e) =>
    (e.type === 'conversation-added' || e.type === 'conversation-updated') &&
    e.conversation.id === id
      ? [e.placement]
      : [],
  )
}

/** A message as each `messages-updated` reported it, oldest report first. */
function updatesOf(events: SessionEvent[], messageId: number): Message[] {
  return messagesOf(events, 'messages-updated').filter((m) => m.id === messageId)
}

function cursorOf(message: Message): { timestamp: number; id: number } {
  return { timestamp: message.timestamp, id: message.id }
}

const bodiesOf = (page: MessagePage): string[] => page.messages.map((m) => m.body)

type ProgressEvent = Extract<SessionEvent, { type: 'attachment-progress' }>

/** A message's upload reports, in the order they arrived. */
function uploadsOf(events: SessionEvent[], messageId: number): ProgressEvent[] {
  return events.filter(
    (e): e is ProgressEvent =>
      e.type === 'attachment-progress' && e.transfer === 'upload' && e.messageId === messageId,
  )
}

function announcedAvailability(
  event: SessionEvent,
  messageId: number,
  index: number,
): AttachmentAvailability | undefined {
  if (event.type !== 'messages-updated') return undefined
  return event.messages.find((m) => m.id === messageId)?.attachments.find((a) => a.index === index)
    ?.availability
}

/**
 * libsession's `image::displayable_image_types`, compared by `mime_essence` with ASCII case
 * folded, as the `galleryViewable` of a message holding one attachment of each type.
 */
const GALLERY_VIEWABLE: [contentType: string, galleryViewable: boolean][] = [
  ['image/jpeg', true],
  ['image/jpg', true],
  ['image/pjpeg', true],
  ['image/png', true],
  ['image/webp', true],
  ['image/gif', true],
  ['image/avif', true],
  ['IMAGE/Jpeg', true],
  ['image/JPG', true],
  ['Image/PJPEG', true],
  ['image/PNG', true],
  ['image/WebP', true],
  ['IMAGE/GIF', true],
  ['image/AVIF', true],
  ['image/heic', false],
  ['image/heif', false],
  ['image/svg+xml', false],
  ['image/tiff', false],
  ['image/bmp', false],
  ['image/apng', false],
  ['image/jxl', false],
  ['image/x-icon', false],
  ['image/jpeg; charset=binary', true],
  ['Image/PNG ; foo=bar', true],
  ['image/jpeg ', true],
  [' image/png', true],
  ['\t\r\nimage/webp\n', true],
  ['\fimage/png', false],
  ['image/png\v', false],
  ['\u00a0image/png', false],
  ['image/png\0', false],
  ['image/apng; charset=binary', false],
  [';image/png', false],
  ['image/', false],
  ['', false],
  ['video/mp4', false],
  ['application/pdf', false],
  ['application/octet-stream', false],
]

export interface ContractOptions {
  /**
   * Scenarios this implementation cannot satisfy, and why, keyed by title.
   *
   * A written reason rather than a flag, because the only honest use of this is a behaviour
   * libsession does not have yet - and the reason is what stops it becoming a way to make a
   * failing implementation look green. The skipped titles carry it into the test output.
   */
  unsupported?: Record<string, string>
}

export function runSessionClientContract(
  harness: ContractHarness,
  t: TestFns,
  options: ContractOptions = {},
): void {
  const { describe, expect } = t
  const unsupported = options.unsupported ?? {}
  const it: Runner = (name, body) => {
    const reason = unsupported[name]
    if (reason === undefined) t.it(name, body)
    else t.it.skip(`${name} - ${reason}`, body)
  }

  /** `second` asked for while `first` is fetching the same file, which one transfer then serves. */
  const joinsRunning = (first: AttachmentTransfer, second: AttachmentTransfer) => async () => {
    const { client, messageId, index, settle } = await harness.withAttachment()
    const seen = collect(client)
    const destination = `/tmp/contract-join-${String(messageId)}-${String(Date.now())}.bin`
    const settled = new Set<AttachmentTransfer>()
    const begin = (kind: AttachmentTransfer) =>
      (kind === 'download'
        ? client.downloadAttachment(messageId, index)
        : client.exportAttachment(messageId, index, destination)
      ).then(
        () => settled.add(kind),
        () => undefined,
      )
    const reports = (kind: AttachmentTransfer) =>
      seen.events.flatMap((e, at) =>
        e.type === 'attachment-progress' &&
        e.transfer === kind &&
        e.messageId === messageId &&
        e.index === index
          ? [{ at, doneBytes: e.doneBytes, totalBytes: e.totalBytes, outcome: e.outcome }]
          : [],
      )

    void begin(first)
    const joinedAt = seen.events.length
    void begin(second)
    await settle()
    // A request left waiting on a transfer nobody drives would never settle, so it is looked for
    // rather than awaited.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect([...settled].sort()).toEqual(['download', 'export'])
    for (const kind of [first, second])
      expect(reports(kind).flatMap((r) => (r.outcome ? [r.outcome.ok] : []))).toEqual([true])

    // Told where the transfer has got to before it reports again, so the joiner's indicator starts
    // there rather than at nothing.
    const before = reports(first).filter((r) => r.at < joinedAt)
    const nextStep = reports(first).find((r) => r.at >= joinedAt)
    const joined = reports(second)[0]
    if (!joined || !nextStep) throw new Error('a transfer did not report')
    expect(before.some((r) => r.outcome !== undefined)).toBe(false)
    expect(nextStep.at).toBeGreaterThan(joined.at)
    const reached = before[before.length - 1] ?? joined
    expect([joined.doneBytes, joined.totalBytes]).toEqual([reached.doneBytes, reached.totalBytes])

    // One transfer, so one run from fetching to cached however many asked for the file.
    const runs = seen.events
      .map((e) => announcedAvailability(e, messageId, index))
      .filter((a) => a !== undefined)
      .filter((a, i, all) => a !== all[i - 1])
    expect(runs).toEqual(['fetching', 'cached'])
    seen.stop()
  }

  describe('SessionClient contract', () => {
    it('has no account until it is asked for one', async () => {
      // What makes onboarding reachable. A client that mints an identity as its database opens
      // has already answered the question the first screen exists to ask.
      const { client } = await harness.newcomer()
      const info = await client.getAccountInfo()
      expect(info.haveAccount).toBe(false)
      expect(info.sessionId).toBeUndefined()
    })

    it('checks a recovery phrase without making an account out of it', async () => {
      // The whole point of the call: onboarding can tell somebody their phrase is wrong while
      // they can still fix it, and still leave the flow with nothing to undo if they go back.
      const { client, phrase } = await harness.newcomer()

      await client.checkRecoveryPhrase(phrase)

      expect((await client.getAccountInfo()).haveAccount).toBe(false)
    })

    it('restores the account the phrase belongs to, through the bytes it travels as', async () => {
      // **The round trip the phrase now takes.** It leaves as a string, crosses as bytes that the
      // sender gives up, and is split back into words by the shim -- so a phrase that restores the
      // right account proves the encode, the transfer and the split all agree. Restoring the wrong
      // account, or none, is what a mismatch anywhere along that would look like.
      const { client, phrase } = await harness.newcomer()
      await client.checkRecoveryPhrase(phrase)

      await client.restoreAccount({ words: phrase })

      const info = await client.getAccountInfo()
      expect(info.haveAccount).toBe(true)
      expect(info.sessionId).toBeDefined()
    })

    it('gives the seed as a recovery QR code carries it, and restores the same account', async () => {
      // The QR code's round trip: what one device draws is what another device restores from.
      // Every existing client reads 16 bytes there, so a 13-word account must come out short.
      const first = await harness.newcomer()
      await first.client.createAccount()
      const hexSeed = await recoveryHex(first.client)
      expect(/^(?:[0-9a-f]{32}){1,2}$/.test(hexSeed)).toBe(true)
      if ((await recoveryWords(first.client)).length === 13) expect(hexSeed.length).toBe(32)
      const { sessionId } = await first.client.getAccountInfo()

      const second = await harness.newcomer()
      await second.client.restoreAccount({ hexSeed })

      expect((await second.client.getAccountInfo()).sessionId).toBe(sessionId)
    })

    it('stops giving the seed out once the recovery password is hidden, and keeps the account', async () => {
      // Hiding is for good, and enforced below the app: neither form of the seed comes back.
      const { client } = await harness.newcomer()
      await client.createAccount()
      const { sessionId } = await client.getAccountInfo()
      expect(await client.getRecoveryPasswordHidden()).toBe(false)

      await client.hideRecoveryPassword()

      expect(await client.getRecoveryPasswordHidden()).toBe(true)
      expect(await client.getSeedMnemonic()).toBe(null)
      expect(await client.getSeedHex()).toBe(null)
      expect((await client.getAccountInfo()).sessionId).toBe(sessionId)
    })

    it('refuses to hide the recovery password before there is an account', async () => {
      // Hidden then, the account made next would start with its recovery password already gone.
      const { client } = await harness.newcomer()

      expect(await failure(() => client.hideRecoveryPassword())).toBeDefined()

      await client.createAccount()
      expect(await client.getRecoveryPasswordHidden()).toBe(false)
      expect((await client.getSeedMnemonic())?.length ?? 0).toBeGreaterThan(0)
    })

    it('refuses a phrase of the wrong length, and still makes nothing', async () => {
      const { client, phrase } = await harness.newcomer()

      expect(await failure(() => client.checkRecoveryPhrase(phrase.slice(0, 5)))).toBeDefined()

      expect((await client.getAccountInfo()).haveAccount).toBe(false)
    })

    it('does not keep an account nobody confirmed across a restart', async () => {
      // The crash case. Minting an account is not the same as deciding to keep it, and a restart
      // that found an unconfirmed one would carry somebody into a setup they never finished --
      // which for a restore means offering to name an account that already has a name.
      const { client } = await harness.newcomer()
      await client.createAccount()
      expect((await client.getAccountInfo()).haveAccount).toBe(true)

      const restarted = await harness.restart(client)

      expect((await restarted.getAccountInfo()).haveAccount).toBe(false)
    })

    it('keeps one that was confirmed', async () => {
      // The other half, and the one that would make the sweep a disaster if it were wrong.
      const { client } = await harness.newcomer()
      await client.createAccount()
      await client.keepAccount()
      const kept = (await client.getAccountInfo()).sessionId

      const restarted = await harness.restart(client)

      const after = await restarted.getAccountInfo()
      expect(after.haveAccount).toBe(true)
      expect(after.sessionId).toBe(kept)
    })

    it('keeps a restored account that was confirmed, and sweeps one that was not', async () => {
      // **Restore has the same two halves as create and had neither of them covered.** The sweep
      // at startup does not care how an account arrived, so a restore that never confirmed is
      // swept exactly as a create would be -- and somebody who restored from their phrase and
      // was swept has lost nothing recoverable, but has been told the restore worked and then
      // shown an empty device on the next launch.
      const hexSeed = 'c3'.repeat(32)

      const provisional = await harness.newcomer()
      await provisional.client.restoreAccount({ hexSeed })
      expect((await provisional.client.getAccountInfo()).haveAccount).toBe(true)
      const sweptAway = await harness.restart(provisional.client)
      expect((await sweptAway.getAccountInfo()).haveAccount).toBe(false)

      const confirmed = await harness.newcomer()
      await confirmed.client.restoreAccount({ hexSeed })
      await confirmed.client.keepAccount()
      const kept = (await confirmed.client.getAccountInfo()).sessionId

      const restarted = await harness.restart(confirmed.client)
      const after = await restarted.getAccountInfo()
      expect(after.haveAccount).toBe(true)
      // The same identity, not merely an identity: a restore that kept the wrong seed would also
      // pass a bare `haveAccount` check.
      expect(after.sessionId).toBe(kept)
    })

    it('refuses requests while its database will not open, until a discard replaces it', async () => {
      // The startup-failure screen depends on both halves: the refusal is what it shows, and the
      // discard is what its Clear Device does.
      const client = await harness.unopenable()
      const refused = await failure(() => client.getAccountInfo())
      expect(
        refused instanceof Error && refused.message.includes('the bridge has no database open'),
      ).toBe(true)

      await client.discardAccount()

      expect((await client.getAccountInfo()).haveAccount).toBe(false)
    })

    it('leaves nothing of an account behind when it is discarded', async () => {
      // Onboarding's undo, and the reason the whole thing exists: somebody who starts restoring
      // one account and changes their mind must not carry any of it into the next.
      //
      // Asserted on what was stored rather than on `haveAccount`, because whether there is an
      // account afterwards is not a property of the discard -- it is a property of how the client
      // was opened. A deferred client comes back with none; one opened eagerly comes back with a
      // *new* one, because that is what opening eagerly means. Either way what the old account put
      // here is gone, and that is the promise.
      const { alice, bobId, settle } = await harness.friends()
      await alice.sendMessage(bobId, { body: 'before' })
      await settle()
      expect((await alice.getConversations()).length).toBeGreaterThan(0)

      await alice.discardAccount()

      expect(await alice.getConversations()).toEqual([])
      expect(await alice.getMessageRequests()).toEqual([])
    })

    it('stores an outgoing message before it is sent', async () => {
      const { alice, bobId } = await harness.friends()
      const seen = collect(alice)

      const messageId = await alice.sendMessage(bobId, { body: 'hello' })

      // The row exists the moment the call resolves - which is why the app needs no
      // optimistic copy of its own to reconcile later.
      const added = messagesOf(seen.events, 'messages-added').find((m) => m.id === messageId)
      expect(added).toBeDefined()
      expect(added?.outgoing).toBe(true)
      expect(['pending', 'sending']).toContain(added?.sendState)
      seen.stop()
    })

    it('reports the sync send apart from the one to the recipient', async () => {
      const { alice, bobId, settle } = await harness.friends()
      const seen = collect(alice)

      const messageId = await alice.sendMessage(bobId, { body: 'hello' })
      await settle()

      const updates = messagesOf(seen.events, 'messages-updated').filter((m) => m.id === messageId)
      const last = updates[updates.length - 1]

      // The copy deposited in our own swarm is a separate send, so it gets its own state and
      // reaches a terminal one of its own. Not asserted to match sendState: the whole reason it
      // is a second field is that the two can disagree.
      expect(last?.syncState).toBeDefined()
      expect(['pending', 'sending', 'sent', 'failed', 'interrupted']).toContain(last?.syncState)
      seen.stop()
    })

    it('reports the send reaching the network as an update, not a second message', async () => {
      const { alice, bobId, settle } = await harness.friends()
      const seen = collect(alice)

      const messageId = await alice.sendMessage(bobId, { body: 'hello' })
      await settle()

      const updates = messagesOf(seen.events, 'messages-updated').filter((m) => m.id === messageId)
      expect(updates.length).toBeGreaterThan(0)
      const last = updates[updates.length - 1]
      // A terminal state, not a particular one: offline - which is what the addon runs as,
      // with no swarm to reach - the send terminates in `failed`, and that is the same
      // contract. What this scenario is about is that it arrived as an update.
      expect(['sent', 'failed']).toContain(last?.sendState)

      const added = messagesOf(seen.events, 'messages-added').filter((m) => m.id === messageId)
      expect(added.length).toBe(1)
      seen.stop()
    })

    it('delivers to the other side', async () => {
      const { alice, bob, aliceId, settle } = await harness.friends()
      await alice.sendMessage((await bob.getAccountInfo()).sessionId ?? '', { body: 'ping' })
      await settle()

      const { messages } = await bob.getMessages(aliceId)
      expect(messages.map((m) => m.body)).toContain('ping')
    })

    it('carries the whole conversation on every change, never just an id', async () => {
      const { alice, bobId, settle } = await harness.friends()
      const seen = collect(alice)

      await alice.sendMessage(bobId, { body: 'hello' })
      await settle()
      // A barrier: the row is reported at the end of libsession's turn.
      await alice.getConversations()

      // Added or updated: whether the first message made the row is the implementation's business.
      const changed = seen.events.find(
        (e) => e.type === 'conversation-added' || e.type === 'conversation-updated',
      )
      expect(changed).toBeDefined()
      if (changed?.type !== 'conversation-added' && changed?.type !== 'conversation-updated')
        throw new Error('unreachable')
      // A display can bind straight to this: it is the new row, not a hint to go and fetch.
      expect(changed.conversation.id).toBe(bobId)
      expect(changed.conversation.displayName).toBeDefined()
      seen.stop()
    })

    it('places a conversation with a new message first in its list', async () => {
      const { alice, bobId, settle } = await harness.friends()
      const seen = collect(alice)

      await alice.sendMessage(bobId, { body: 'hello' })
      await settle()
      // Also a barrier: libsession reports a changed row at the end of its loop's turn, so the
      // answer to a later query comes after the report on the stream.
      const [top] = await alice.getConversations()

      // The last word on the row, as a subscriber applying them in order ends up with it.
      const placement = placementsOf(seen.events, bobId).at(-1)
      expect(top?.id).toBe(bobId)
      expect(placement?.to).toBe('conversations')
      // Nothing sorts before the newest activity, which an unset `after` is what says.
      expect(placement?.after).toBeUndefined()
      seen.stop()
    })

    it('places a request in the request list', async () => {
      const { alice, bob, bobId, settle } = await harness.strangers()
      const aliceId = (await alice.getAccountInfo()).sessionId ?? ''
      const seen = collect(alice)

      await bob.sendMessage(aliceId, { body: 'still here' })
      await settle()
      const [top] = await alice.getMessageRequests()

      const placement = placementsOf(seen.events, bobId).at(-1)
      expect(top?.id).toBe(bobId)
      expect(placement?.to).toBe('requests')
      expect(placement?.after).toBeUndefined()
      seen.stop()
    })

    it('moves an approved request between the two lists', async () => {
      const { alice, bobId } = await harness.strangers()

      const before = await alice.getConversations()
      const requestsBefore = await alice.getMessageRequests()
      expect(before.some((c: Conversation) => c.id === bobId)).toBe(false)
      expect(requestsBefore.some((c: Conversation) => c.id === bobId)).toBe(true)

      const seen = collect(alice)
      await alice.approveConversation(bobId)

      const after = await alice.getConversations()
      const requestsAfter = await alice.getMessageRequests()
      // Approval arrives as an update whose placement crosses lists: out of the requests and into
      // the conversations, in one event a display applies to both.
      expect(placementsOf(seen.events, bobId).at(-1)?.to).toBe('conversations')
      expect(after.some((c: Conversation) => c.id === bobId)).toBe(true)
      expect(requestsAfter.some((c: Conversation) => c.id === bobId)).toBe(false)
      seen.stop()
    })

    it('moves a request it writes back to into the conversations', async () => {
      const { alice, bobId, settle } = await harness.strangers()
      const seen = collect(alice)

      await alice.sendMessage(bobId, { body: 'come in' })
      await settle()
      const [top] = await alice.getConversations()
      const requests = await alice.getMessageRequests()

      const placement = placementsOf(seen.events, bobId).at(-1)
      expect(placement?.to).toBe('conversations')
      expect(placement?.after).toBeUndefined()
      expect(top?.id).toBe(bobId)
      expect(requests.some((c: Conversation) => c.id === bobId)).toBe(false)
      seen.stop()
    })

    it('places a pin at the top and a hide in neither list', async () => {
      const { alice, bobId, settle } = await harness.friends()
      await alice.sendMessage(bobId, { body: 'hello' })
      await settle()

      const pinned = collect(alice)
      await alice.setPriority(bobId, 1)
      await settle()
      await alice.getConversations()
      expect(placementsOf(pinned.events, bobId).at(-1)?.to).toBe('conversations')
      expect(placementsOf(pinned.events, bobId).at(-1)?.after).toBeUndefined()
      pinned.stop()

      const hidden = collect(alice)
      await alice.setPriority(bobId, -1)
      await settle()
      const conversations = await alice.getConversations()
      expect(placementsOf(hidden.events, bobId).at(-1)?.to).toBe('none')
      expect(conversations.some((c: Conversation) => c.id === bobId)).toBe(false)
      hidden.stop()
    })

    it('pages history without duplicating a message at the seam', async () => {
      const { alice, bobId, settle } = await harness.friends()
      for (let i = 0; i < 5; i += 1) {
        await alice.sendMessage(bobId, { body: `m${i}` })
        await settle()
      }

      const { messages: newest } = await alice.getMessages(bobId, { limit: 2 })
      expect(newest.length).toBe(2)

      const oldest = newest[0]
      if (!oldest) throw new Error('unreachable')
      const { messages: older } = await alice.getMessages(bobId, {
        limit: 2,
        before: { timestamp: oldest.timestamp, id: oldest.id },
      })

      const overlap = older.filter((m) => newest.some((n) => n.id === m.id))
      expect(overlap.length).toBe(0)
    })

    /** Nine messages of alice's, `m1` the oldest, as she lists them. */
    const nineMessages = async () => {
      const { alice, bobId, settle } = await harness.friends()
      for (let i = 1; i <= 9; i += 1) {
        await alice.sendMessage(bobId, { body: `m${String(i)}` })
        await settle()
      }
      const { messages } = await alice.getMessages(bobId, { limit: 20 })
      const idOf = (body: string): number => {
        const found = messages.find((m) => m.body === body)
        if (!found) throw new Error(`${body} was not stored`)
        return found.id
      }
      return { alice, bobId, messages, idOf }
    }

    it('says whether history goes on past a page, either way', async () => {
      const { alice, bobId, messages } = await nineMessages()

      const newest = await alice.getMessages(bobId, { limit: 3 })
      expect(bodiesOf(newest)).toEqual(['m7', 'm8', 'm9'])
      expect([newest.hasOlder, newest.hasNewer]).toEqual([true, false])

      const whole = await alice.getMessages(bobId, { limit: 9 })
      expect([whole.hasOlder, whole.hasNewer]).toEqual([false, false])

      // Read before a cursor, newer counts from the cursor: the caller holds that message.
      const m7 = messages[6]
      const m4 = messages[3]
      if (!m7 || !m4) throw new Error('unreachable')
      const middle = await alice.getMessages(bobId, { limit: 3, before: cursorOf(m7) })
      expect(bodiesOf(middle)).toEqual(['m4', 'm5', 'm6'])
      expect([middle.hasOlder, middle.hasNewer]).toEqual([true, true])

      const oldest = await alice.getMessages(bobId, { limit: 3, before: cursorOf(m4) })
      expect(bodiesOf(oldest)).toEqual(['m1', 'm2', 'm3'])
      expect([oldest.hasOlder, oldest.hasNewer]).toEqual([false, true])
    })

    it('reads a window around a message, filling a short side from the other', async () => {
      const { alice, bobId, idOf } = await nineMessages()
      const around = (body: string, limit: number) =>
        alice.getMessages(bobId, { limit, around: idOf(body) })

      // Of the rest, half older and half newer; an even limit's spare row is newer.
      const middle = await around('m5', 5)
      expect(bodiesOf(middle)).toEqual(['m3', 'm4', 'm5', 'm6', 'm7'])
      expect([middle.hasOlder, middle.hasNewer]).toEqual([true, true])
      expect(bodiesOf(await around('m5', 4))).toEqual(['m4', 'm5', 'm6', 'm7'])

      const first = await around('m1', 5)
      expect(bodiesOf(first)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5'])
      expect([first.hasOlder, first.hasNewer]).toEqual([false, true])

      const last = await around('m9', 5)
      expect(bodiesOf(last)).toEqual(['m5', 'm6', 'm7', 'm8', 'm9'])
      expect([last.hasOlder, last.hasNewer]).toEqual([true, false])

      const all = await around('m5', 20)
      expect(all.messages.length).toBe(9)
      expect([all.hasOlder, all.hasNewer]).toEqual([false, false])
    })

    it('places a window by a deleted message it leaves out', async () => {
      const { alice, bobId, idOf } = await nineMessages()
      await alice.deleteMessage(idOf('m5'), 'here')

      const hidden = await alice.getMessages(bobId, { limit: 5, around: idOf('m5') })
      expect(bodiesOf(hidden)).toEqual(['m3', 'm4', 'm6', 'm7', 'm8'])

      const shown = await alice.getMessages(bobId, {
        limit: 5,
        around: idOf('m5'),
        includeDeleted: true,
      })
      expect(shown.messages.map((m) => m.id)[2]).toBe(idOf('m5'))
    })

    it('refuses a window around a message the conversation does not hold', async () => {
      const { alice, bobId } = await nineMessages()
      const refused = await failure(() => alice.getMessages(bobId, { limit: 5, around: 987_654 }))
      expect(refused instanceof SessionClientError).toBe(true)
      expect((refused as SessionClientError).code).toBe(MESSAGE_NOT_FOUND)
    })

    it('refuses a page asked for from two positions', async () => {
      const { alice, bobId, messages, idOf } = await nineMessages()
      const m5 = messages[4]
      if (!m5) throw new Error('unreachable')
      const cursor = cursorOf(m5)
      const asked = [
        { before: cursor, after: cursor },
        { before: cursor, around: idOf('m5') },
        { after: cursor, around: idOf('m5') },
      ]
      for (const positions of asked) {
        const refused = await failure(() => alice.getMessages(bobId, { limit: 3, ...positions }))
        expect(refused instanceof Error).toBe(true)
      }
    })

    it('pages newer from a window to the newest message, repeating nothing', async () => {
      const { alice, bobId, idOf } = await nineMessages()

      let page = await alice.getMessages(bobId, { limit: 3, around: idOf('m2') })
      const read = bodiesOf(page)
      expect(read).toEqual(['m1', 'm2', 'm3'])
      let pages = 0
      while (page.hasNewer) {
        const last = page.messages[page.messages.length - 1]
        if (!last) throw new Error('a page said there was more and held nothing')
        page = await alice.getMessages(bobId, { limit: 3, after: cursorOf(last) })
        // Read after a cursor, older counts from the cursor.
        expect(page.hasOlder).toBe(true)
        read.push(...bodiesOf(page))
        pages += 1
      }

      expect(pages).toBe(2)
      expect(read).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9'])
    })

    it('carries a reply to the other side with the message it answers', async () => {
      const { alice, bob, aliceId, bobId, settle } = await harness.friends()
      const questionId = await alice.sendMessage(bobId, { body: 'question' })
      await settle()
      const question = (await bob.getMessages(aliceId)).messages.find((m) => m.body === 'question')
      if (!question) throw new Error('the question did not arrive')

      await bob.sendMessage(aliceId, { body: 'answer', replyTo: question.id })
      await settle()

      // Each side resolves the reference against its own copy: the same message, under each
      // side's own id, and outgoing only for whoever wrote it.
      const sent = (await bob.getMessages(aliceId)).messages.find((m) => m.body === 'answer')
      expect(sent?.replyTo?.author).toBe(aliceId)
      expect(sent?.replyTo?.timestamp).toBe(question.timestamp)
      expect(sent?.replyTo?.messageId).toBe(question.id)
      expect(sent?.replyTo?.message).toEqual({
        id: question.id,
        outgoing: false,
        body: 'question',
        attachments: [],
      })

      const received = (await alice.getMessages(bobId)).messages.find((m) => m.body === 'answer')
      expect(received?.replyTo?.author).toBe(aliceId)
      expect(received?.replyTo?.message).toEqual({
        id: questionId,
        outgoing: true,
        body: 'question',
        attachments: [],
      })
    })

    it('refuses a reply to a message the conversation does not hold, storing nothing', async () => {
      const { alice, bobId } = await harness.friends()
      const refused = await failure(() =>
        alice.sendMessage(bobId, { body: 'to nothing', replyTo: 987_654 }),
      )
      expect(refused instanceof Error).toBe(true)
      expect((await alice.getMessages(bobId)).messages.length).toBe(0)
    })

    it('names who a reply answers before that message is here, and resolves it once it is', async () => {
      const { client, conversationId, receive } = await harness.receivesMessages()
      const asked = Date.now()

      await receive({
        body: 'answer',
        timestamp: asked + 1000,
        replyTo: { author: conversationId, timestamp: asked },
      })
      const before = (await client.getMessages(conversationId)).messages
      expect(before.map((m) => m.body)).toEqual(['answer'])
      // The wire names a message by its author and time, so both are known without it.
      expect(before[0]?.replyTo).toEqual({ author: conversationId, timestamp: asked })

      const seen = collect(client)
      await receive({ body: 'question', timestamp: asked })
      // History is ordered by each message's own time, not by arrival.
      const after = (await client.getMessages(conversationId)).messages
      expect(after.map((m) => m.body)).toEqual(['question', 'answer'])
      const [question, answer] = after
      if (!question || !answer) throw new Error('unreachable')

      const resolved = updatesOf(seen.events, answer.id).pop()
      expect(resolved?.replyTo?.messageId).toBe(question.id)
      expect(resolved?.replyTo?.message?.body).toBe('question')
      expect(answer.replyTo?.message?.body).toBe('question')
      seen.stop()
    })

    it('reports a reply again when the message it answers is deleted', async () => {
      const { alice, bobId, settle } = await harness.friends()
      const questionId = await alice.sendMessage(bobId, { body: 'question' })
      const answerId = await alice.sendMessage(bobId, { body: 'answer', replyTo: questionId })
      await settle()

      const seen = collect(alice)
      await alice.deleteMessage(questionId, 'here')
      await settle()

      // Still here, as a row with nothing in it: a reply can tell deleted from never received.
      const expected = {
        id: questionId,
        outgoing: true,
        body: '',
        attachments: [],
        deleted: 'here',
      }
      expect(updatesOf(seen.events, answerId).pop()?.replyTo?.message).toEqual(expected)
      const answer = (await alice.getMessages(bobId)).messages.find((m) => m.id === answerId)
      expect(answer?.replyTo?.messageId).toBe(questionId)
      expect(answer?.replyTo?.message).toEqual(expected)
      seen.stop()
    })

    it('reports a reply again when a thumbnail of the picture it answers is made', async () => {
      const { client, conversationId, messageId, index, settle } = await harness.withAttachment()
      const replyId = await client.sendMessage(conversationId, { body: 'nice', replyTo: messageId })
      await settle()
      const quotedOf = (message: Message | undefined) =>
        message?.replyTo?.message?.attachments.find((a) => a.index === index)
      const sent = (await client.getMessages(conversationId)).messages.find((m) => m.id === replyId)
      expect(quotedOf(sent)?.hasThumbnail).toBe(false)
      expect(quotedOf(sent)?.availability).toBe('absent')

      const seen = collect(client)
      const running = client.downloadAttachment(messageId, index)
      await settle()
      await running

      const reported = updatesOf(seen.events, replyId).map((m) => quotedOf(m))
      expect(reported.some((a) => a?.availability === 'fetching')).toBe(true)
      expect(reported.pop()?.hasThumbnail).toBe(true)
      seen.stop()
    })

    it('leaves an interrupted send visible after a restart', async () => {
      const { alice, bobId } = await harness.friends()
      await alice.sendMessage(bobId, { body: 'in flight' })

      const restarted = await harness.restart(alice)
      const { messages } = await restarted.getMessages(bobId)
      const inFlight = messages.find((m) => m.body === 'in flight')

      expect(inFlight).toBeDefined()
      // libsession's send queue does not survive the process; a UI that has never seen
      // this state spins for ever after a crash.
      expect(['interrupted', 'sent', 'failed']).toContain(inFlight?.sendState)
    })

    it('refuses a push token that is empty, before asking the push server', async () => {
      const { alice } = await harness.friends()
      const error = await failure(() => alice.setPushToken('firebase', ''))
      expect(error instanceof SessionClientError).toBe(true)
      const forced = await failure(() => alice.setPushToken('firebase', '', true))
      expect(forced instanceof SessionClientError).toBe(true)
    })

    it('clears a push subscription that was never made without asking anything', async () => {
      // Answered at once, network or not: switching away from Instant must never hang on a server
      // it has nothing to tell.
      const { alice } = await harness.friends()
      await alice.clearPushToken()
      await alice.clearPushToken()
    })

    it('shows the name and the message until another choice of notification content', async () => {
      const { alice } = await harness.friends()
      expect(await alice.getNotificationContent()).toBe('nameAndContent')
      await alice.setNotificationContent('none')
      expect(await alice.getNotificationContent()).toBe('none')
      await alice.setNotificationContent('nameOnly')
      expect(await alice.getNotificationContent()).toBe('nameOnly')
    })

    it('stops and restarts receiving, and refuses to while closed for the background', async () => {
      const { alice } = await harness.friends()
      await alice.setReceiving(false)
      await alice.setReceiving(true)

      await alice.closeClient(10_000, 15_000)
      expect(await failure(() => alice.setReceiving(true))).toBeDefined()
      await alice.reopenClient()
      await alice.setReceiving(true)
    })

    it('notifies a message that arrives, naming the message for a tap to land on', async () => {
      const { client, conversationId, receive } = await harness.receivesMessages()
      const seen = collect(client)
      await receive({ body: 'land here', timestamp: Date.now() })
      await eventually(() => notificationsOf(seen.events).length > 0)
      const arrived = messagesOf(seen.events, 'messages-added').find((m) => m.body === 'land here')
      const [shown] = notificationsOf(seen.events)
      expect(arrived).toBeDefined()
      expect(shown?.conversationId).toBe(conversationId)
      expect(shown?.messageId).toBe(arrived?.id)
      seen.stop()
    })

    it('notifies a message that arrives, once, and takes it down when it is read', async () => {
      const { client, conversationId, receive } = await harness.receivesMessages()
      const seen = collect(client)
      await receive({ body: 'are you there?', timestamp: Date.now() })
      await eventually(() => notificationsOf(seen.events).length > 0)

      const [shown, ...more] = notificationsOf(seen.events)
      expect(more).toEqual([])
      expect(shown?.kind).toBe('message')
      expect(shown?.conversationId).toBe(conversationId)
      expect(shown?.body).toBe('are you there?')
      expect(shown?.sender).toBeDefined()
      const badges = () => seen.events.flatMap((e) => (e.type === 'badge' ? [e.count] : []))
      await eventually(() => badges().at(-1) === 1)
      expect(badges().at(-1)).toBe(1)

      await client.markRead(conversationId)
      await eventually(() => staleOf(seen.events).length > 0 && badges().at(-1) === 0)
      expect(staleOf(seen.events)).toEqual([shown?.id])
      expect(badges().at(-1)).toBe(0)
      seen.stop()
    })

    it('names no one and says nothing when the content setting hides both', async () => {
      const { client, receive } = await harness.receivesMessages()
      await client.setNotificationContent('none')
      const seen = collect(client)
      await receive({ body: 'secret', timestamp: Date.now() })
      await eventually(() => notificationsOf(seen.events).length > 0)
      const [shown] = notificationsOf(seen.events)
      expect(shown?.kind).toBe('message')
      expect(shown?.sender).toBeUndefined()
      expect(shown?.body).toBeUndefined()
      seen.stop()
    })

    it('does not announce history from before the device had the account', async () => {
      const { client, receive } = await harness.receivesMessages()
      const seen = collect(client)
      await receive({ body: 'from last week', timestamp: Date.now() - 7 * 24 * 3600 * 1000 })
      await receive({ body: 'now', timestamp: Date.now() })
      // Stamped a minute ago, as a slow send is, and arriving after the one above: still announced.
      await receive({ body: 'sent a minute ago', timestamp: Date.now() - 60_000 })
      await eventually(() => notificationsOf(seen.events).length > 1)
      expect(notificationsOf(seen.events).map((n) => n.body)).toEqual(['now', 'sent a minute ago'])
      seen.stop()
    })

    it('plays Note until another notification sound is chosen, and keeps no sound as a choice', async () => {
      const { alice } = await harness.friends()
      expect(await alice.getNotificationSound()).toBe('note')
      await alice.setNotificationSound('bamboo')
      expect(await alice.getNotificationSound()).toBe('bamboo')
      // Stored as a number of its own, not as the unset default.
      await alice.setNotificationSound('none')
      expect(await alice.getNotificationSound()).toBe('none')
    })

    it('closes for the background, refusing requests until it is reopened', async () => {
      const { alice, bobId } = await harness.friends()
      const before = await alice.getAccountInfo()

      // Nothing outbound, so nothing to wait for.
      const closed = await alice.closeClient(10_000, 15_000)
      expect(closed.closed).toBe(true)
      expect(closed.outboundBusy).toBe(false)
      expect(closed.interrupted).toBe(false)

      // Refused rather than left waiting: the app may still be asking things as it goes.
      expect((await failure(() => alice.getAccountInfo())) instanceof SessionClientError).toBe(true)
      expect(
        (await failure(() => alice.closeClient(10_000, 15_000))) instanceof SessionClientError,
      ).toBe(true)

      await alice.reopenClient()
      expect((await alice.getAccountInfo()).sessionId).toBe(before.sessionId)
      expect((await alice.getConversations()).some((c) => c.id === bobId)).toBe(true)
      // Nothing to undo a second time.
      await alice.reopenClient()
      expect((await alice.getAccountInfo()).sessionId).toBe(before.sessionId)
    })

    it('makes an account after closing for the background during onboarding', async () => {
      // Onboarding is where the app spends its first background trip: somebody looks away while
      // choosing a name, and the account has to be made on the Client built on return.
      const { client } = await harness.newcomer()
      expect((await client.closeClient(10_000, 15_000)).closed).toBe(true)
      await client.reopenClient()

      await client.createAccount()
      await client.setDisplayName('Back again')
      await client.keepAccount()
      const info = await client.getAccountInfo()
      expect(info.haveAccount).toBe(true)
      expect(info.displayName).toBe('Back again')
    })

    it('keeps the client when it is reopened while the close waits for a send', async () => {
      const { alice, bobId } = await harness.friends()
      await alice.sendMessage(bobId, { body: 'still going' })

      const closing = alice.closeClient(10_000, 15_000)
      // Working while it waits, but nothing may replace the Client the close is waiting on.
      expect((await alice.getConversations()).some((c) => c.id === bobId)).toBe(true)
      expect((await failure(() => alice.discardAccount())) instanceof SessionClientError).toBe(true)

      await alice.reopenClient()
      const closed = await closing
      expect(closed.closed).toBe(false)
      expect(closed.waitedMs < 10_000).toBe(true)
      expect((await alice.getMessages(bobId)).messages.some((m) => m.body === 'still going')).toBe(
        true,
      )
    })

    it('leaves a send the close did not wait out interrupted once reopened', async () => {
      const { alice, bobId } = await harness.friends()
      await alice.sendMessage(bobId, { body: 'cut off' })

      const closed = await alice.closeClient(0, 15_000)
      expect(closed.closed).toBe(true)
      await alice.reopenClient()

      const { messages } = await alice.getMessages(bobId)
      const cutOff = messages.find((m) => m.body === 'cut off')
      // As after a restart: the send queue went with the Client, and a send left spinning would
      // spin for ever.
      expect(['interrupted', 'sent', 'failed']).toContain(cutOff?.sendState)
    })

    it('refuses a negative wait or interrupt', async () => {
      const { alice } = await harness.friends()
      for (const [waitMs, interruptMs] of [
        [-1, 15_000],
        [10_000, -1],
      ] as const) {
        const error = await failure(() => alice.closeClient(waitMs, interruptMs))
        expect(error instanceof SessionClientError).toBe(true)
      }
      // Refused before it began, so the client is open as before.
      await alice.getAccountInfo()
    })

    it('retries a send a restart stopped, uploading again and settling by update', async () => {
      const { alice, bobId, settle, writeFile } = await harness.friends()
      const path = await writeFile('again.txt', 1_200)
      const messageId = await alice.sendMessage(bobId, {
        body: 'again',
        attachments: [{ path, contentType: 'text/plain' }],
      })

      const restarted = await harness.restart(alice)
      const { messages } = await restarted.getMessages(bobId)
      // Stopped with its file not up: failed or interrupted, whether or not there is a network.
      expect(['failed', 'interrupted']).toContain(
        messages.find((m) => m.id === messageId)?.sendState,
      )

      const seen = collect(restarted)
      expect(await restarted.retrySend(messageId)).toBe(true)
      const last = () =>
        messagesOf(seen.events, 'messages-updated')
          .filter((m) => m.id === messageId)
          .at(-1)?.sendState
      // Offline, as the addon runs, the upload fails again; with a network it is sent.
      const terminal = new Set(['sent', 'failed'])
      for (let round = 0; round < 50 && !terminal.has(last() ?? ''); round += 1) {
        await settle()
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      expect(messagesOf(seen.events, 'messages-updated').some((m) => m.id === messageId)).toBe(true)
      expect(['sent', 'failed']).toContain(last())
      // The retry's upload reports as the first send's would have, ending once either way.
      const outcomes = uploadsOf(seen.events, messageId).filter((e) => e.outcome !== undefined)
      expect(outcomes.map((e) => [e.index, e.outcome?.ok])).toEqual([[0, last() === 'sent']])
      seen.stop()
    })

    it('reports each upload against the id the send answered, and ends it once', async () => {
      const { alice, bobId, settle, writeFile } = await harness.friends()
      const first = await writeFile('first.txt', 40_000)
      const second = await writeFile('second.txt', 1_200)
      const seen = collect(alice)

      const messageId = await alice.sendMessage(bobId, {
        body: '',
        attachments: [
          { path: first, contentType: 'text/plain' },
          { path: second, contentType: 'text/plain' },
        ],
      })
      // Every event up to the answer, at least: a report among them was sent before the id was.
      const answered = seen.events.length
      expect(
        seen.events
          .slice(0, answered)
          .filter((e) => e.type === 'attachment-progress' && e.transfer === 'upload'),
      ).toEqual([])

      const last = () =>
        messagesOf(seen.events, 'messages-updated')
          .filter((m) => m.id === messageId)
          .at(-1)?.sendState
      const terminal = new Set(['sent', 'failed'])
      for (let round = 0; round < 50 && !terminal.has(last() ?? ''); round += 1) {
        await settle()
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      const state = last()
      expect(['sent', 'failed']).toContain(state)

      // Nothing names another message: the send's own id, never a guess at it.
      const reports = seen.events.filter(
        (e): e is ProgressEvent => e.type === 'attachment-progress' && e.transfer === 'upload',
      )
      expect(reports.every((e) => e.messageId === messageId)).toBe(true)
      // Per file: at most one outcome, and nothing after it.
      for (const index of [0, 1]) {
        const own = reports.filter((e) => e.index === index)
        const ended = own.filter((e) => e.outcome !== undefined)
        expect(ended.length <= 1 && (ended.length === 0 || own.at(-1) === ended[0])).toBe(true)
      }
      const outcomes = reports.flatMap((e) => (e.outcome === undefined ? [] : [e]))
      if (state === 'sent') {
        // Both up, in order: libsession uploads a message's files one at a time.
        expect(outcomes.map((e) => [e.index, e.outcome?.ok])).toEqual([
          [0, true],
          [1, true],
        ])
      } else {
        // Offline, as the addon runs: the first fails, with its reason, and the second is never
        // tried, so it reports nothing at all.
        expect(outcomes.map((e) => [e.index, e.outcome?.ok])).toEqual([[0, false]])
        expect(typeof outcomes[0]?.outcome?.error).toBe('string')
        expect(reports.some((e) => e.index === 1)).toBe(false)
      }
      seen.stop()
    })

    it('stores a message with its files before uploading them, and settles it after', async () => {
      const { alice, bobId, settle, writeFile } = await harness.friends()
      const path = await writeFile('notes.txt', 1_200)
      const seen = collect(alice)

      // No body: a message can be only its files.
      const messageId = await alice.sendMessage(bobId, {
        body: '',
        attachments: [{ path, contentType: 'text/plain', filename: 'for bob.txt' }],
      })

      const added = messagesOf(seen.events, 'messages-added').find((m) => m.id === messageId)
      expect(added?.sendState).toBe('uploading')
      expect(
        added?.attachments.map((a) => [a.index, a.filename, a.contentType, a.uploaded]),
      ).toEqual([[0, 'for bob.txt', 'text/plain', false]])

      // Offline, as the addon runs, the upload fails; either way it leaves `uploading` by update.
      const last = () =>
        messagesOf(seen.events, 'messages-updated')
          .filter((m) => m.id === messageId)
          .at(-1)?.sendState
      const terminal = new Set(['sent', 'failed'])
      for (let round = 0; round < 50 && !terminal.has(last() ?? ''); round += 1) {
        await settle()
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      expect(['sent', 'failed']).toContain(last())
      seen.stop()
    })

    it('types a file sent without a type by its extension', async () => {
      const { alice, bobId, writeFile } = await harness.friends()
      const path = await writeFile('minutes.PDF', 2_000)
      const sheet = await writeFile('budget.xlsx', 2_000)
      const seen = collect(alice)

      const messageId = await alice.sendMessage(bobId, {
        body: '',
        attachments: [{ path }, { path: sheet }],
      })

      const added = messagesOf(seen.events, 'messages-added').find((m) => m.id === messageId)
      expect(added?.attachments.map((a) => a.contentType)).toEqual([
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ])
      seen.stop()
    })

    it('marks a picture it cannot decode as the original file, and nothing else', async () => {
      const { alice, bobId, settle, writeFile } = await harness.friends()
      const bitmap = await writeFile('scan.bmp', 2_000)
      const notes = await writeFile('notes.txt', 2_000)

      const messageId = await alice.sendMessage(bobId, {
        body: '',
        attachments: [{ path: bitmap, contentType: 'image/bmp' }, { path: notes }],
      })
      // libsession decides as it reads the file for sending, after the message is stored.
      const flags = async () =>
        (await alice.getMessages(bobId)).messages
          .find((m) => m.id === messageId)
          ?.attachments.map((a) => a.originalFile)
      for (let round = 0; round < 50 && (await flags())?.[0] !== true; round += 1) {
        await settle()
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      expect(await flags()).toEqual([true, false])
    })

    it('plans a send from the file, its label and the file server limit, sending nothing', async () => {
      const { alice, bobId, writeFile } = await harness.friends()
      const notes = await writeFile('notes.txt', 2_000)
      // Well past the limit either way it is counted, plaintext or padded and encrypted.
      const big = await writeFile('big.bin', 12_000_000)
      const scan = await writeFile('scan.bmp', 2_000)
      const hugeScan = await writeFile('huge.bmp', 12_000_000)
      const tiff = await writeFile('scan.tiff', 2_000)
      const seen = collect(alice)

      expect(await alice.attachmentSendPlan(notes)).toBe('as-is')
      expect(await alice.attachmentSendPlan(notes, 'text/plain')).toBe('as-is')
      expect(await alice.attachmentSendPlan(big)).toBe('too-large-for-server')
      // A label that is a picture this build does not read goes as the original file.
      expect(await alice.attachmentSendPlan(scan, 'image/bmp')).toBe('original-cannot-decode')
      expect(await alice.attachmentSendPlan(scan, 'Image/BMP; x=y')).toBe('original-cannot-decode')
      expect(await alice.attachmentSendPlan(hugeScan, 'image/bmp')).toBe('too-large-for-server')
      // Unlabelled, typed by its extension as a send types it.
      expect(await alice.attachmentSendPlan(tiff)).toBe('original-cannot-decode')
      expect(await alice.attachmentSendPlan(`${notes}.gone`)).toBe('missing')

      expect((await alice.getMessages(bobId)).messages).toEqual([])
      expect(seen.events.filter((e) => e.type !== 'log')).toEqual([])
      seen.stop()
    })

    it('names the file server limit a send plan holds a file to, counted encrypted', async () => {
      const { alice } = await harness.friends()
      // The built-in servers' default, which the scenario below is the plaintext edge of.
      expect(await alice.getAttachmentUploadLimit()).toBe(10_000_000)
    })

    it('holds a file sent as it is to the file server limit once it is encrypted', async () => {
      const { alice, writeFile } = await harness.friends()
      // 9,956,278 bytes encrypt to just within the default 10,000,000; one more byte does not.
      const fits = await writeFile('fits.bin', 9_956_278)
      const over = await writeFile('over.bin', 9_956_279)

      expect(await alice.attachmentSendPlan(fits)).toBe('as-is')
      expect(await alice.attachmentSendPlan(over)).toBe('too-large-for-server')
      expect(await alice.attachmentSendPlan(fits, 'image/bmp')).toBe('original-cannot-decode')
      expect(await alice.attachmentSendPlan(over, 'image/bmp')).toBe('too-large-for-server')
    })

    it('serves its own copy of every file a send carries before it is up', async () => {
      const { alice, bobId, writeFile, removeFile, aliceMedia } = await harness.friends()
      const taken = await writeFile('taken.txt', 2_000)
      const lent = await writeFile('lent.txt', 3_000)
      const seen = collect(alice)

      const messageId = await alice.sendMessage(bobId, {
        body: '',
        attachments: [
          { path: taken, filename: 'taken.txt', takeFile: true },
          { path: lent, filename: 'lent.txt' },
        ],
      })

      const added = messagesOf(seen.events, 'messages-added').find((m) => m.id === messageId)
      expect(added?.attachments.map((a) => a.uploaded)).toEqual([false, false])
      expect(added?.attachments[0]?.availability).toBe('cached')
      // libsession copies a file it was not handed off the calling thread, and says so by update.
      let lentAvailability = added?.attachments[1]?.availability
      for (let round = 0; round < 100 && lentAvailability !== 'cached'; round += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20))
        lentAvailability = (await alice.getMessages(bobId)).messages
          .find((m) => m.id === messageId)
          ?.attachments.find((a) => a.index === 1)?.availability
      }
      expect(lentAvailability).toBe('cached')

      // From here the caller's file is not read.
      await removeFile(lent)
      expect((await aliceMedia.fetchMedia({ messageId, index: 0 })).bytes.length).toBe(2_000)
      expect((await aliceMedia.fetchMedia({ messageId, index: 1 })).bytes.length).toBe(3_000)
      const message = (await alice.getMessages(bobId)).messages.find((m) => m.id === messageId)
      expect(message?.sendState === 'unsendable').toBe(false)
      seen.stop()
    })

    it('thumbnails a picture we send before it is up, and never takes that back', async () => {
      const { alice, bobId, settle, writeFile, writePicture } = await harness.friends()
      const photo = await writePicture('photo.jpg', 640, 480)
      const notes = await writeFile('notes.txt', 2_000)
      const seen = collect(alice)

      const messageId = await alice.sendMessage(bobId, {
        body: '',
        attachments: [{ path: photo }, { path: notes }],
      })
      // libsession makes it off its loop, and says so by update.
      const thumbnailed = async () =>
        (await alice.getMessages(bobId)).messages.find((m) => m.id === messageId)?.attachments[0]
          ?.hasThumbnail === true
      for (let round = 0; round < 100 && !(await thumbnailed()); round += 1) {
        await settle()
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      await settle()

      // Every announcement from the first with a thumbnail on, including the upload's and the
      // cached file's own thumbnail taking over.
      const announced = [
        ...messagesOf(seen.events, 'messages-added'),
        ...messagesOf(seen.events, 'messages-updated'),
      ].filter((m) => m.id === messageId)
      const from = announced.findIndex((m) => m.attachments[0]?.hasThumbnail === true)
      expect(from).toBeGreaterThan(-1)
      expect(announced[from]?.attachments[0]?.uploaded).toBe(false)
      const after = announced.slice(from).map((m) => m.attachments[0])
      expect(after.every((a) => a?.hasThumbnail === true && (a.thumbnailWidthPx ?? 0) > 0)).toBe(
        true,
      )
      expect(announced.some((m) => m.attachments[1]?.hasThumbnail === true)).toBe(false)
      seen.stop()
    })

    it('refuses a send whose file is missing or empty, storing nothing', async () => {
      const { alice, bobId, writeFile } = await harness.friends()
      const empty = await writeFile('empty.bin', 0)
      const seen = collect(alice)

      const missing = await failure(() =>
        alice.sendMessage(bobId, { body: 'gone', attachments: [{ path: `${empty}.gone` }] }),
      )
      const blank = await failure(() =>
        alice.sendMessage(bobId, { body: 'empty', attachments: [{ path: empty }] }),
      )

      expect(missing instanceof SessionClientError).toBe(true)
      expect(blank instanceof SessionClientError).toBe(true)
      expect(messagesOf(seen.events, 'messages-added').length).toBe(0)
      seen.stop()
    })

    it('delivers the files of a message to the other side once they are up', async () => {
      const { alice, bob, aliceId, bobId, settle, writeFile } = await harness.friends()
      const path = await writeFile('harbour.jpg', 48_000)

      const messageId = await alice.sendMessage(bobId, {
        body: 'look',
        attachments: [{ path, contentType: 'image/jpeg' }],
      })
      await settle()

      const sent = (await alice.getMessages(bobId)).messages.find((m) => m.id === messageId)
      expect(sent?.sendState).toBe('sent')
      expect(sent?.attachments.map((a) => a.uploaded)).toEqual([true])
      const arrived = (await bob.getMessages(aliceId)).messages.find((m) => m.body === 'look')
      expect(arrived?.attachments.map((a) => [a.filename, a.contentType, a.uploaded])).toEqual([
        ['harbour.jpg', 'image/jpeg', true],
      ])
    })

    it('fails a message whose files were still uploading across a restart', async () => {
      const { alice, bobId, writeFile } = await harness.friends()
      const path = await writeFile('draft.pdf', 30_000)
      await alice.sendMessage(bobId, {
        body: 'mid-upload',
        attachments: [{ path, contentType: 'application/pdf' }],
      })

      const restarted = await harness.restart(alice)
      const { messages } = await restarted.getMessages(bobId)

      // Nothing reached a swarm before the files were up, so this is no unknown: it is a failure,
      // and a retry is safe.
      expect(messages.find((m) => m.body === 'mid-upload')?.sendState).toBe('failed')
    })

    it('clears a conversation by replacing its history, not by removing it', async () => {
      const { alice, bobId, settle } = await harness.friends()
      await alice.sendMessage(bobId, { body: 'hello' })
      await settle()

      const seen = collect(alice)
      await alice.deleteMessage((await alice.getMessages(bobId)).messages[0]?.id ?? 0, 'here')
      expect(seen.events.some((e) => e.type === 'conversation-removed')).toBe(false)
      seen.stop()
    })

    it('leaves a deleted message out of history unless it is asked for', async () => {
      const { alice, bobId, settle } = await harness.friends()
      await alice.sendMessage(bobId, { body: 'hello' })
      await settle()

      const { messages: before } = await alice.getMessages(bobId)
      const target = before[0]
      if (!target) throw new Error('unreachable')
      await alice.deleteMessage(target.id, 'here')
      await settle()

      const { messages: visible } = await alice.getMessages(bobId)
      expect(visible.some((m) => m.id === target.id)).toBe(false)

      const { messages: withDeleted } = await alice.getMessages(bobId, { includeDeleted: true })
      const deleted = withDeleted.find((m) => m.id === target.id)
      expect(deleted?.deleted).toBe('here')
    })

    it('never gives a deleted message id to a newer message', async () => {
      const { alice, bobId, settle } = await harness.friends()
      const { sessionId } = await alice.getAccountInfo()
      if (!sessionId) throw new Error('unreachable')
      const noteToSelf = await alice.openDm(sessionId)
      await alice.sendMessage(noteToSelf, { body: 'kept' })
      await alice.sendMessage(bobId, { body: 'gone' })
      await settle()

      // Removes the newest row, whose id is the one a reusing insert would take next.
      const { messages } = await alice.getMessages(bobId, { includeDeleted: true })
      expect(messages.map((m) => m.body)).toContain('gone')
      const highest = Math.max(...messages.map((m) => m.id))
      await alice.deleteConversation(bobId)
      await settle()

      await alice.sendMessage(noteToSelf, { body: 'next' })
      await settle()
      const { messages: after } = await alice.getMessages(noteToSelf)
      const next = after.find((m) => m.body === 'next')
      expect(next?.id).toBeGreaterThan(highest)
    })

    it('refuses a seed that is not 16 or 32 bytes of hex', async () => {
      const { alice } = await harness.friends()

      // oxenc's from_hex is UB on non-hex or odd-length input, so the refusal precedes the decode.
      for (const hexSeed of ['', 'zz'.repeat(32), `${'ab'.repeat(31)}a`, 'ab'.repeat(24)]) {
        const error = await failure(() => alice.restoreAccount({ hexSeed }))
        expect(error instanceof Error).toBe(true)
        expect(String(error)).toContain('hexSeed')
      }
    })

    it('refuses a poll interval that is not one, and accepts a short one', async () => {
      const { alice } = await harness.friends()

      // Core reads a non-positive interval as "as fast as the loop will go", which is a busy loop
      // against the swarm rather than a slow poll.
      for (const intervalMs of [0, -1]) {
        const error = await failure(() => alice.setPollInterval(intervalMs))
        expect(error instanceof Error).toBe(true)
      }

      // The reason this exists: a test should not wait out the 20-second default.
      await alice.setPollInterval(50)
    })

    it('refuses a page size that is not a page', async () => {
      const { alice, bobId } = await harness.friends()

      // A limit is a page size, not a sentinel: there is no value meaning "all of it".
      for (const limit of [0, -1]) {
        const error = await failure(() => alice.getMessages(bobId, { limit }))
        expect(error instanceof Error).toBe(true)
      }
    })

    it('refuses a nickname on note to self rather than never answering', async () => {
      const { alice } = await harness.friends()
      const { sessionId } = await alice.getAccountInfo()
      if (!sessionId) throw new Error('unreachable')
      const noteToSelf = await alice.openDm(sessionId)

      // libsession refuses this from inside a callback, where a throw is only logged.
      const error = await failure(() => alice.setNickname(noteToSelf, 'me'))
      expect(error instanceof Error).toBe(true)
    })

    /**
     * The refusal, which is the half of this that holds without a network.
     *
     * Warming exists for the window before an account, so the condition worth pinning is that it
     * declines once there is one: the client's own network is then the thing doing this, and a
     * second one refreshing the same cache is the cost the command avoids rather than the saving
     * it makes.
     *
     * **The success case cannot be asserted here.** Filling a pool means reaching service nodes,
     * and this suite runs offline; a build with no network configured answers false for that
     * reason rather than this one, so a scenario asserting true would pass on the fake and fail on
     * the addon for a reason that has nothing to do with the contract.
     */
    it('declines to warm the node cache once an account is there to use it', async () => {
      const { alice } = await harness.friends()
      expect((await alice.getAccountInfo()).haveAccount).toBe(true)

      expect(await alice.warmNetworkCache()).toBe(false)
    })

    it('takes onion requests or direct on a devnet, which Session Router has none of', async () => {
      // With no account yet, attaching only records the choice: nothing goes to the network.
      const { client } = await harness.newcomer()
      const devnet = {
        netid: 'devnet',
        seedNodes: [
          { ed25519PubkeyHex: 'a'.repeat(64), ip: '10.0.0.1', httpsPort: 1300, omqPort: 1305 },
        ],
      }
      for (const router of ['onion-requests', 'direct'] as const)
        expect(await failure(() => client.attachNetwork({ ...devnet, router }))).toBeUndefined()
    })

    /**
     * The half of the network status that holds offline. Whether a path comes up needs service
     * nodes, which this suite never reaches; the event's shape is the echo test's.
     */
    it('reports no network as disconnected', async () => {
      const { alice } = await harness.friends()
      expect(await alice.getNetworkStatus()).toBe('disconnected')
    })

    /**
     * As with the status: paths need service nodes, so only their absence is asserted here. So does
     * the node cache the countries are counted from.
     */
    it('holds no paths and counts no countries without a network', async () => {
      const { alice } = await harness.friends()
      const snapshot = await alice.getNetworkPaths()
      expect(snapshot.paths).toEqual([])
      expect(snapshot.nodesByCountry).toEqual([])
      expect(typeof snapshot.countryAttribution).toBe('string')
    })

    it('goes nowhere on a network accepted before there is an account', async () => {
      const { client } = await harness.newcomer()
      const seen = collect(client)
      // Accepted and recorded, and attached only once an account exists to attach it to.
      await client.attachNetwork({
        netid: 'devnet',
        router: 'onion-requests',
        seedNodes: [
          { ed25519PubkeyHex: 'a'.repeat(64), ip: '10.0.0.1', httpsPort: 1300, omqPort: 1305 },
        ],
      })
      expect(await client.getNetworkStatus()).toBe('disconnected')
      expect(seen.events.filter((e) => e.type === 'network-status-changed')).toEqual([])
      seen.stop()
    })

    it('refuses a network it cannot build, and stays where it was', async () => {
      const { alice } = await harness.friends()
      const before = (await alice.getAccountInfo()).networkAttached

      // devnet is the only netid libsession has no seeds of its own for, and a seed node is
      // dialled directly: a name where an address belongs never becomes one.
      const refused = [
        { netid: 'nonsense' },
        { netid: 'devnet' },
        {
          netid: 'devnet',
          seedNodes: [
            {
              ed25519PubkeyHex: 'a'.repeat(64),
              ip: 'seed.devnet.test',
              httpsPort: 1300,
              omqPort: 1305,
            },
          ],
        },
        {
          netid: 'devnet',
          seedNodes: [
            { ed25519PubkeyHex: 'nothex', ip: '10.0.0.1', httpsPort: 1300, omqPort: 1305 },
          ],
        },
        // Session Router has no devnet, so this pair is refused however well-formed it is.
        {
          netid: 'devnet',
          router: 'session-router' as const,
          seedNodes: [
            { ed25519PubkeyHex: 'a'.repeat(64), ip: '10.0.0.1', httpsPort: 1300, omqPort: 1305 },
          ],
        },
      ]

      const accepted: string[] = []
      for (const config of refused)
        if ((await failure(() => alice.attachNetwork(config))) === undefined)
          accepted.push(JSON.stringify(config))
      expect(accepted).toEqual([])

      // Refused whole: a network half applied is one nobody asked for, and the next call that
      // brings an account into being would be the one to throw on it.
      expect((await alice.getAccountInfo()).networkAttached).toBe(before)
    })

    it('reports a download from nothing to a result', async () => {
      const { client, messageId, index, settle } = await harness.withAttachment()
      const seen = collect(client)

      // Started, then settled, then awaited: a transfer runs on whatever drives the
      // implementation forward, and awaiting it before settling would wait on a clock that only
      // this test advances.
      const running = client.downloadAttachment(messageId, index)
      await settle()
      await running

      const reports = seen.events.filter(
        (e) =>
          e.type === 'attachment-progress' &&
          e.transfer === 'download' &&
          e.messageId === messageId &&
          e.index === index,
      )
      expect(reports.length).toBeGreaterThan(1)

      const first = reports[0]
      if (first?.type !== 'attachment-progress') throw new Error('unreachable')
      // Nothing has been asked of a server yet, so there is no size to report and no fraction
      // to draw: the first report only means that something started.
      expect(first.doneBytes).toBe(0)
      expect(first.totalBytes).toBe(0)
      expect(first.outcome).toBeUndefined()

      const terminal = reports.filter(
        (e) => e.type === 'attachment-progress' && e.outcome !== undefined,
      )
      // Exactly one for the one handler, and it is the last: a caller that treats every report as
      // possibly-final would finish the transfer early, and one waiting for doneBytes ===
      // totalBytes never would.
      expect(terminal.length).toBe(1)
      expect(terminal[0]).toBe(reports[reports.length - 1])
      const last = terminal[0]
      if (last?.type !== 'attachment-progress') throw new Error('unreachable')
      expect(last.outcome?.ok).toBe(true)
      expect(last.outcome?.error).toBeUndefined()

      seen.stop()
    })

    it('joins a running download, and ends it once per handler', async () => {
      const { client, messageId, index, settle } = await harness.withAttachment()
      const seen = collect(client)

      const first = client.downloadAttachment(messageId, index)
      const joined = client.downloadAttachment(messageId, index)
      await settle()
      await Promise.all([first, joined])

      const reports = seen.events.filter(
        (e) =>
          e.type === 'attachment-progress' &&
          e.transfer === 'download' &&
          e.messageId === messageId &&
          e.index === index,
      )
      const terminal = reports.filter(
        (e) => e.type === 'attachment-progress' && e.outcome !== undefined,
      )
      // One transfer, two handlers: each is told it finished, so a caller keyed on the transfer
      // sees the same end twice and has to tolerate it.
      expect(terminal.length).toBe(2)
      expect(terminal.every((e) => e.type === 'attachment-progress' && e.outcome?.ok)).toBe(true)
      expect(reports.slice(-2)).toEqual(terminal)
      seen.stop()
    })

    it('answers a download of what is already here without reporting again', async () => {
      const { client, messageId, index, settle } = await harness.withAttachment()
      const first = client.downloadAttachment(messageId, index)
      await settle()
      await first

      const seen = collect(client)
      const again = client.downloadAttachment(messageId, index)
      await settle()
      await again

      // A cache hit reports nothing at all, which is why an indicator cannot be driven by
      // reports arriving: it would sit there for ever on the one case that is instant.
      expect(seen.events.filter((e) => e.type === 'attachment-progress').length).toBe(0)
      seen.stop()
    })

    it('reports an export as its own transfer', async () => {
      const { client, conversationId, messageId, index, settle } = await harness.withAttachment()
      const seen = collect(client)
      const destination = `/tmp/contract-export-${String(messageId)}-${String(Date.now())}.bin`

      const exporting = client.exportAttachment(messageId, index, destination)
      await settle()
      // Nothing is at a fresh path, so nothing collides and it lands where it was sent.
      expect(await exporting).toBe(destination)

      const exports = seen.events.filter(
        (e) => e.type === 'attachment-progress' && e.transfer === 'export',
      )
      // Reported as an export even on a transfer a download shares, which is what keeps an
      // indicator of one from reading the other's reports.
      expect(exports.length).toBeGreaterThan(0)
      const terminal = exports.filter(
        (e) => e.type === 'attachment-progress' && e.outcome !== undefined,
      )
      expect(terminal.length).toBe(1)
      expect(terminal[0]).toBe(exports[exports.length - 1])
      const last = terminal[0]
      if (last?.type !== 'attachment-progress') throw new Error('unreachable')
      expect(last.outcome?.ok).toBe(true)

      const saved = (await client.getMessages(conversationId)).messages
        .find((m) => m.id === messageId)
        ?.attachments.find((a) => a.index === index)
      expect(typeof saved?.savedAtMs).toBe('number')
      seen.stop()
    })

    it('exports beside a file already written rather than over it, unless told to replace', async () => {
      const { client, messageId, index, settle } = await harness.withAttachment()
      const stem = `/tmp/contract-repeat-${String(messageId)}-${String(Date.now())}`
      const exported = async (replace?: boolean) => {
        const landing = client.exportAttachment(messageId, index, `${stem}.bin`, { replace })
        await settle()
        return landing
      }

      expect(await exported()).toBe(`${stem}.bin`)
      expect(await exported(false)).toBe(`${stem} (1).bin`)
      expect(await exported()).toBe(`${stem} (2).bin`)
      expect(await exported(true)).toBe(`${stem}.bin`)
    })

    it('answers a page with what its attachments are doing', async () => {
      const { client, conversationId, messageId, index, settle } = await harness.withAttachment()

      const at = (page: MessagePage) =>
        page.messages.find((m) => m.id === messageId)?.attachments.find((a) => a.index === index)

      const idle = at(await client.getMessages(conversationId))
      // Carried on the attachment rather than beside the page: "nobody is fetching this" is what
      // a row offering to fetch it needs to hear, and it is not the same as having nothing to
      // fetch. `absent` says the next call would start a download.
      expect(idle).toBeDefined()
      expect(idle?.availability).toBe('absent')
      expect(idle?.fetchDoneBytes).toBe(0)

      const running = client.downloadAttachment(messageId, index)
      await settle()
      await running

      // The reason this exists: a screen that was not listening has no other way back to the
      // truth, and asking for the bytes to find out would be a download rather than a question.
      const cached = at(await client.getMessages(conversationId))
      expect(cached?.availability).toBe('cached')
    })

    it('refuses a download of a file the server no longer holds, before any transfer starts', async () => {
      const { client, conversationId, messageId, index, settle } = await harness.withAttachment({
        expired: true,
      })
      const at = async () =>
        (await client.getMessages(conversationId)).messages
          .find((m) => m.id === messageId)
          ?.attachments.find((a) => a.index === index)
      expect((await at())?.availability).toBe('notFound')

      const seen = collect(client)
      const refused = await failure(() => client.downloadAttachment(messageId, index))
      await settle()

      // A verdict is answered from what is stored, so nothing is fetched and nothing reports: the
      // refusal and the page are the only places it shows.
      expect(refused instanceof SessionClientError && refused.code).toBe(FILE_NOT_FOUND)
      expect(seen.events.filter((e) => e.type === 'attachment-progress')).toEqual([])
      expect((await at())?.availability).toBe('notFound')
      seen.stop()
    })

    it('refuses an attachment of a message that does not exist', async () => {
      const { alice } = await harness.friends()
      const destination = `/tmp/contract-missing-${String(Date.now())}.bin`

      const download = await failure(() => alice.downloadAttachment(999_999, 0))
      const exported = await failure(() => alice.exportAttachment(999_999, 0, destination))

      expect(download instanceof SessionClientError && download.code).toBe(MESSAGE_NOT_FOUND)
      expect(exported instanceof SessionClientError && exported.code).toBe(MESSAGE_NOT_FOUND)
    })

    it('refuses an attachment index the message does not have', async () => {
      const { client, messageId } = await harness.withAttachment()
      const destination = `/tmp/contract-missing-${String(Date.now())}.bin`
      // Past any count a message can carry: an implementation may seed more than the one promised.
      const missing = 999

      const download = await failure(() => client.downloadAttachment(messageId, missing))
      const exported = await failure(() => client.exportAttachment(messageId, missing, destination))

      expect(download instanceof SessionClientError && download.code).toBe(ATTACHMENT_NOT_FOUND)
      expect(exported instanceof SessionClientError && exported.code).toBe(ATTACHMENT_NOT_FOUND)
    })

    it('announces an attachment as fetching while its download runs', async () => {
      const { client, messageId, index, settle } = await harness.withAttachment()
      const seen = collect(client)

      const running = client.downloadAttachment(messageId, index)
      await settle()
      await running

      // A screen opened mid-transfer draws from the message, so the message has to say it.
      const availability = (e: SessionEvent) => announcedAvailability(e, messageId, index)
      const fetching = seen.events.findIndex((e) => availability(e) === 'fetching')
      const terminal = seen.events.findIndex(
        (e) => e.type === 'attachment-progress' && e.outcome !== undefined,
      )
      expect(fetching).toBeGreaterThan(-1)
      expect(terminal).toBeGreaterThan(fetching)
      expect(seen.events.slice(terminal).some((e) => availability(e) === 'cached')).toBe(true)
      seen.stop()
    })

    it('fetches an uncached export into the cache, reading as fetching meanwhile', async () => {
      const { client, conversationId, messageId, index, settle } = await harness.withAttachment()
      const seen = collect(client)
      const destination = `/tmp/contract-export-fetch-${String(messageId)}-${String(Date.now())}.bin`

      const exporting = client.exportAttachment(messageId, index, destination)
      await settle()
      await exporting

      // The export is the file's transfer, so a tile drawn meanwhile shows its progress rather than
      // offering a download.
      const availability = (e: SessionEvent) => announcedAvailability(e, messageId, index)
      const fetching = seen.events.findIndex((e) => availability(e) === 'fetching')
      const ended = seen.events.findIndex(
        (e) =>
          e.type === 'attachment-progress' && e.transfer === 'export' && e.outcome !== undefined,
      )
      expect(fetching).toBeGreaterThan(-1)
      expect(ended).toBeGreaterThan(fetching)

      const kept = (await client.getMessages(conversationId)).messages
        .find((m) => m.id === messageId)
        ?.attachments.find((a) => a.index === index)
      expect(kept?.availability).toBe('cached')

      const after = seen.events.length
      const download = client.downloadAttachment(messageId, index)
      await settle()
      await download
      expect(seen.events.slice(after).filter((e) => e.type === 'attachment-progress')).toEqual([])
      seen.stop()
    })

    it('joins an export to a running download', joinsRunning('download', 'export'))

    it('joins a download to a running export', joinsRunning('export', 'download'))

    it('withdraws what was asked of an attachment once it is deleted', async () => {
      const { client, conversationId, messageId, index, settle, receiveImage } =
        await harness.withAttachment()
      const image = await receiveImage()
      const seen = collect(client)
      const destination = `/tmp/contract-withdrawn-${String(image)}-${String(Date.now())}.bin`

      // Each asked for, and its attachment deleted before anything drives the transfer on: one
      // with its message, settled before the other goes with its conversation.
      const code = (error: unknown) => error instanceof SessionClientError && error.code
      const downloading = failure(() => client.downloadAttachment(messageId, index))
      await client.deleteMessage(messageId, 'here')
      await settle()
      expect(code(await downloading)).toBe(FILE_DOWNLOAD_CANCELLED)

      const exporting = failure(() => client.exportAttachment(image, 0, destination))
      await client.deleteConversation(conversationId)
      await settle()
      expect(code(await exporting)).toBe(FILE_DOWNLOAD_CANCELLED)

      // Each request's last report says so too, rather than a transfer finishing for an
      // attachment that no longer exists.
      const ends = seen.events.flatMap((e) =>
        e.type === 'attachment-progress' && e.outcome !== undefined
          ? [[e.transfer, e.messageId, e.outcome.ok, e.outcome.error]]
          : [],
      )
      expect(ends).toEqual([
        ['download', messageId, false, FILE_DOWNLOAD_CANCELLED],
        ['export', image, false, FILE_DOWNLOAD_CANCELLED],
      ])
      seen.stop()
    })

    it('fetches an arriving image unasked once told to fetch images', async () => {
      const { client, conversationId, receiveImage, settle } = await harness.withAttachment()
      await client.setAutoDownload(conversationId, 'image-attachments')
      const seen = collect(client)

      const messageId = await receiveImage()
      await settle()

      const ended = seen.events.find(
        (e) =>
          e.type === 'attachment-progress' &&
          e.transfer === 'download' &&
          e.messageId === messageId &&
          e.outcome !== undefined,
      )
      expect(ended?.type === 'attachment-progress' && ended.outcome?.ok).toBe(true)
      const image = (await client.getMessages(conversationId)).messages.find(
        (m) => m.id === messageId,
      )?.attachments[0]
      expect(image?.availability).toBe('cached')
      expect(image?.renditionRefused).toBe(false)
      seen.stop()
    })

    it('says when it will make no rendition of a picture it holds', async () => {
      const { client, conversationId, messageId, index, settle } = await harness.withAttachment({
        pastPixelLimits: true,
      })
      const held = async () =>
        (await client.getMessages(conversationId)).messages
          .find((m) => m.id === messageId)
          ?.attachments.find((a) => a.index === index)
      expect((await held())?.renditionRefused).toBe(false)

      const running = client.downloadAttachment(messageId, index)
      await settle()
      await running
      // libsession settles it as it reads the cached file's header, and says so by update.
      for (let round = 0; round < 100 && (await held())?.renditionRefused !== true; round += 1) {
        await settle()
        await new Promise((resolve) => setTimeout(resolve, 20))
      }

      const picture = await held()
      expect(picture?.availability).toBe('cached')
      expect([picture?.renditionRefused, picture?.hasRendition, picture?.hasThumbnail]).toEqual([
        true,
        false,
        false,
      ])
    })

    it('shows a message as a gallery only when every attachment is an image libsession displays', async () => {
      // The fake keeps its own copy of libsession's list, so the answers are written out here:
      // derived from that copy, a type libsession added or dropped would pass on the fake.
      const { receive } = await harness.receivesAttachments()
      const answers: [contentType: string, galleryViewable: boolean][] = []
      for (const [contentType] of GALLERY_VIEWABLE)
        answers.push([contentType, (await receive([contentType])).galleryViewable])
      expect(answers).toEqual(GALLERY_VIEWABLE)

      expect((await receive(['image/jpeg', 'application/pdf'])).galleryViewable).toBe(false)
      expect((await receive(['image/heic', 'image/png'])).galleryViewable).toBe(false)
      expect((await receive(['image/png', 'IMAGE/GIF'])).galleryViewable).toBe(true)
    })

    it('gives a picture no thumbnail size before it has a thumbnail', async () => {
      const { receive } = await harness.receivesAttachments()
      const [picture] = (await receive(['image/jpeg'])).attachments
      expect(picture?.hasThumbnail).toBe(false)
      expect([picture?.thumbnailWidthPx, picture?.thumbnailHeightPx]).toEqual([0, 0])
    })

    it('starts a message as a gallery exactly where it can be one', async () => {
      const { receive } = await harness.receivesAttachments()
      expect((await receive(['image/jpeg', 'image/png'])).gallery).toBe(true)
      expect((await receive(['image/jpeg', 'application/pdf'])).gallery).toBe(false)
    })

    it('stores a gallery choice, announces it, and keeps it across a restart', async () => {
      const { client, conversationId, receive } = await harness.receivesAttachments()
      const { id } = await receive(['image/jpeg'])
      const seen = collect(client)

      expect(await client.setGallery(id, false)).toBe(true)
      const announced = messagesOf(seen.events, 'messages-updated').filter((m) => m.id === id)
      expect(announced.map((m) => m.gallery)).toEqual([false])
      seen.stop()

      const restarted = await harness.restart(client)
      const stored = async () =>
        (await restarted.getMessages(conversationId)).messages.find((m) => m.id === id)?.gallery
      expect(await stored()).toBe(false)

      expect(await restarted.setGallery(id, true)).toBe(true)
      expect(await stored()).toBe(true)
    })

    it('announces nothing when asked for the gallery choice already stored', async () => {
      const { client, receive } = await harness.receivesAttachments()
      const { id } = await receive(['image/png'])
      const seen = collect(client)
      expect(await client.setGallery(id, true)).toBe(true)
      // The stream is ordered, so a no-op that announced would show up ahead of the real change.
      expect(await client.setGallery(id, false)).toBe(true)
      const announced = messagesOf(seen.events, 'messages-updated').filter((m) => m.id === id)
      expect(announced.map((m) => m.gallery)).toEqual([false])
      seen.stop()
    })

    it('refuses a gallery for a message that cannot be one, and for one that does not exist', async () => {
      const { client, conversationId, receive } = await harness.receivesAttachments()
      const { id } = await receive(['image/jpeg', 'application/pdf'])
      expect(await client.setGallery(id, true)).toBe(false)
      expect(await client.setGallery(id, false)).toBe(true)
      const page = await client.getMessages(conversationId)
      expect(page.messages.find((m) => m.id === id)?.gallery).toBe(false)
      expect(await client.setGallery(987_654_321, false)).toBe(false)
    })

    it('has no attachment cache limit until one is set, and reads back the one set', async () => {
      const { alice } = await harness.friends()
      expect(typeof (await alice.getCacheDir())).toBe('string')
      expect(await alice.getAttachmentCacheLimit()).toBeUndefined()

      await alice.setAttachmentCacheLimit(250_000_000)
      expect(await alice.getAttachmentCacheLimit()).toBe(250_000_000)

      await alice.setAttachmentCacheLimit(undefined)
      expect(await alice.getAttachmentCacheLimit()).toBeUndefined()
    })

    it('refuses a negative attachment cache limit and keeps the one it had', async () => {
      const { alice } = await harness.friends()
      await alice.setAttachmentCacheLimit(250_000_000)

      const error = await failure(() => alice.setAttachmentCacheLimit(-1))
      expect(error instanceof Error ? error.message : error).toContain('must not be negative')
      expect(await alice.getAttachmentCacheLimit()).toBe(250_000_000)
    })

    it('clamps the thumbnail edge it keeps, and forgets it when unset', async () => {
      const { alice } = await harness.friends()
      const opened = await alice.getThumbnailEdge()

      await alice.setThumbnailEdge(300)
      expect(await alice.getThumbnailEdge()).toBe(300)
      await alice.setThumbnailEdge(4096)
      expect(await alice.getThumbnailEdge()).toBe(1024)
      await alice.setThumbnailEdge(1)
      expect(await alice.getThumbnailEdge()).toBe(64)

      await alice.setThumbnailEdge(undefined)
      expect(await alice.getThumbnailEdge()).toBe(opened)
    })

    it('refuses a thumbnail edge past what the bridge carries and keeps the one it had', async () => {
      const { alice } = await harness.friends()
      await alice.setThumbnailEdge(300)

      const error = await failure(() => alice.setThumbnailEdge(2 ** 32))
      expect(error instanceof Error ? error.message : error).toContain(
        'setThumbnailEdge.edgePx must be a whole number this bridge can carry',
      )
      expect(await alice.getThumbnailEdge()).toBe(300)
    })

    it("measures each of the account's configs, listed by name", async () => {
      const { alice } = await harness.friends()
      const sizes = await alice.getConfigSizes()
      expect(sizes.map((size) => size.name)).toEqual([
        'contacts',
        'convo_info_volatile',
        'local',
        'user_groups',
        'user_profile',
      ])
      for (const size of sizes) expect(size.bytes).toBeGreaterThan(0)
    })

    it('measures an attachment cache with nothing in it as empty', async () => {
      const { alice } = await harness.friends()
      expect(await alice.getAttachmentCacheSize()).toBe(0)
    })

    it('counts a downloaded attachment in the cache size', async () => {
      const { client, messageId, index, settle } = await harness.withAttachment()
      const before = await client.getAttachmentCacheSize()

      const running = client.downloadAttachment(messageId, index)
      await settle()
      await running

      expect(await client.getAttachmentCacheSize()).toBeGreaterThan(before)
    })

    it('remembers being told to download nothing, which is not the same as never asking', async () => {
      const { client, conversationId } = await harness.withAttachment()

      const before = await client.getConversation(conversationId)
      expect(before.autoDownload).toBeUndefined()

      await client.setAutoDownload(conversationId, 'none')

      // The distinction the prompt depends on: unset means nobody has been asked, so a client
      // that stored `none` as "unset" would ask again for ever.
      const after = await client.getConversation(conversationId)
      expect(after.autoDownload).toBe('none')
    })

    it('rejects everything still waiting when it closes', async () => {
      const { alice, bobId } = await harness.friends()
      const pending = alice.sendMessage(bobId, { body: 'never' }).catch((error: unknown) => error)
      alice.close()

      const outcome = await pending
      // A promise that never settles would be worse than a rejection: nothing upstream
      // could tell the difference between "slow" and "gone".
      expect(typeof outcome === 'number' || outcome instanceof Error).toBe(true)
    })
  })
}
