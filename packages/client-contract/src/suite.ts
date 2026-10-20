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
  FILE_NOT_FOUND,
  MESSAGE_NOT_FOUND,
  SessionClientError,
  type AttachmentAvailability,
  type Conversation,
  type Message,
  type MessagePage,
  type SessionClient,
  type SessionEvent,
} from '@session/client'

export interface ContractHarness {
  /** Two clients that already know each other, with no history and no attachments. */
  friends(): Promise<{
    alice: SessionClient
    bob: SessionClient
    aliceId: string
    bobId: string
    /** Lets whatever is in flight finish: a manual clock, or a real poll. */
    settle: () => Promise<void>
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
   * `expired` asks for one the file server no longer holds.
   */
  withAttachment(options?: { expired?: boolean }): Promise<{
    client: SessionClient
    conversationId: string
    messageId: number
    index: number
    settle: () => Promise<void>
    /** Delivers another incoming message holding one image, and answers its id. */
    receiveImage: () => Promise<number>
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

/** What a `messages-updated` event says about one attachment, if it mentions it. */
function announcedAvailability(
  event: SessionEvent,
  messageId: number,
  index: number,
): AttachmentAvailability | undefined {
  if (event.type !== 'messages-updated') return undefined
  return event.messages.find((m) => m.id === messageId)?.attachments.find((a) => a.index === index)
    ?.availability
}

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

      const updated = seen.events.find((e) => e.type === 'conversation-updated')
      expect(updated).toBeDefined()
      if (updated?.type !== 'conversation-updated') throw new Error('unreachable')
      // A display can bind straight to this: it is the new row, not a hint to go and fetch.
      expect(updated.conversation.id).toBe(bobId)
      expect(updated.conversation.displayName).toBeDefined()
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

      // Approval arrives as an update, so both lists have to be re-sent for the row to
      // move: a display that only watched one of them would show it twice or not at all.
      expect(seen.events.some((e) => e.type === 'conversation-list-replaced')).toBe(true)
      expect(seen.events.some((e) => e.type === 'request-list-replaced')).toBe(true)

      const after = await alice.getConversations()
      const requestsAfter = await alice.getMessageRequests()
      expect(after.some((c: Conversation) => c.id === bobId)).toBe(true)
      expect(requestsAfter.some((c: Conversation) => c.id === bobId)).toBe(false)
      seen.stop()
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

    it('refuses a seed that is not 32 bytes of hex', async () => {
      const { alice } = await harness.friends()

      // oxenc's from_hex is UB on non-hex or odd-length input, so the refusal precedes the decode.
      for (const hexSeed of ['', 'zz'.repeat(32), `${'ab'.repeat(31)}a`]) {
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
      // libsession joins downloads with each other and never joins an export, so the two are
      // distinguishable even for the same file - which is the only thing that keeps a single
      // progress indicator from reading two transfers as one.
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
      seen.stop()
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
