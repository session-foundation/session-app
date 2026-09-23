import type { AutoDownload, ConversationId, Message, SessionClient } from '@session/client'
import { createStore, type StoreApi } from 'zustand/vanilla'

import { applyEvent, mergePages, withoutHistory } from './applyEvent'
import { emptyState, type MessageWindow, type SessionState } from './types'

export interface SessionActions {
  /**
   * Starts the app, and is the only call that is allowed to fail without throwing.
   *
   * `hydrate` still throws, because every other caller is a screen that has somewhere to put a
   * refusal. This one has not: it runs before there is a screen, from an app's root, and a
   * rejection there is an unhandled promise and a launch screen that stays up for ever. So the
   * failure becomes `startupError` instead -- one catch site, which is what the legacy iOS client
   * has and what it has instead of a timeout.
   */
  start: () => Promise<void>
  /**
   * Deletes everything on this device and starts again from nothing.
   *
   * The way out of a database that cannot be opened. Destructive and unrecoverable without a
   * recovery phrase, so nothing calls it without asking twice.
   */
  clearDeviceData: () => Promise<void>
  /**
   * Reads and writes a preference libsession stores against the account.
   *
   * **There is nowhere to put a preference until an account exists**, which is what makes this a
   * store action rather than a module of its own: the caller has to be somewhere that knows
   * whether hydrate has happened. Reading before then answers undefined rather than throwing, so a
   * caller can ask on every start without first asking whether it is too early.
   */
  getPreference: (key: string) => Promise<string | undefined>
  setPreference: (key: string, value: string) => Promise<void>
  /**
   * Subscribes first, then asks - never the other way round.
   *
   * Anything that arrives between the two is applied on top of the answer, which is safe
   * precisely because every event carries whole state. Asking first and subscribing after
   * is what loses a change that lands in the gap.
   */
  hydrate: () => Promise<void>
  loadHistory: (id: ConversationId) => Promise<void>
  loadOlder: (id: ConversationId) => Promise<void>
  send: (id: ConversationId, body: string, replyTo?: number) => Promise<void>
  markRead: (id: ConversationId) => Promise<void>
  approve: (id: ConversationId) => Promise<void>
  /**
   * Mints an identity, and re-hydrates because everything else waits on there being one.
   *
   * The bridge attaches the network on the far side of this, since attaching to an
   * identity-less Core throws - so this is also the moment the app goes online.
   */
  createAccount: () => Promise<void>
  /**
   * Takes over an identity that already exists, from its recovery phrase or its raw seed.
   *
   * Re-hydrates for the same reason `createAccount` does, and goes online at the same point: as
   * far as everything above here is concerned the two are the same event, and only the screens
   * that led to them differ.
   *
   * The words are handed down as they were typed. libsession owns the word list and the codec, so
   * it is the only thing that can say whether a phrase is a phrase -- a second copy of that
   * judgement up here would be a second answer to disagree with.
   */
  restoreAccount: (
    from: { words: string[]; language?: string } | { hexSeed: string },
  ) => Promise<void>
  /**
   * Asks whether a phrase would restore, and changes nothing either way.
   *
   * Does not re-hydrate, because by design nothing has happened: this is what lets onboarding
   * refuse a phrase at the screen that asked for it while still leaving the person free to go
   * back to a device with no account on it.
   */
  checkRecoveryPhrase: (words: string[], language?: string) => Promise<void>
  /**
   * Throws the account away and starts from nothing, then re-hydrates onto the empty result.
   *
   * Onboarding's undo. Re-hydrating is not optional: the bridge has deleted the database and
   * opened a new one, so every conversation and message window the store is holding belongs to an
   * account that no longer exists on this device.
   */
  discardAccount: () => Promise<void>
  /**
   * Says the account is here to stay, so a start that finds it does not sweep it away.
   *
   * The last thing onboarding does. Does not re-hydrate: nothing observable changes, which is the
   * point -- it is the difference between an account that survives a restart and one that does not.
   */
  keepAccount: () => Promise<void>
  /**
   * Re-reads the account and nothing else.
   *
   * libsession pushes conversations and messages but has no event for the account itself, so a
   * display name that arrives from the swarm after a restore is invisible until something asks
   * again. Onboarding's wait is the one place that has to notice, and it has fifteen seconds to
   * do it in - so it asks. `hydrate` would do the job and would refetch every conversation each
   * time, which during a restore is the whole history.
   */
  refreshAccount: () => Promise<void>
  /**
   * Names the account, during onboarding and afterwards.
   *
   * Re-hydrates rather than waiting for an event, because the name is read back on the very next
   * screen and a whole-state push that has not arrived yet would show the previous one.
   */
  setDisplayName: (name: string) => Promise<void>
  /**
   * Opens the conversation with an account, creating it if this is the first contact.
   *
   * Returns the conversation id so the caller can navigate to it - which is the app's job, not
   * the store's.
   */
  startConversation: (accountId: string) => Promise<ConversationId>
  /**
   * Resumes a send that failed. Resumes rather than restarts: files already uploaded are not
   * sent again, which is why this is not "send it once more".
   */
  retry: (messageId: number) => Promise<boolean>
  /**
   * Fetches an attachment, and answers whether the bytes are here by fetching them: one that is
   * already cached resolves at once and reports nothing at all.
   *
   * Progress arrives as events, so nothing is returned: a row that mounts halfway through a
   * transfer reads the same state as one that started it.
   */
  downloadAttachment: (messageId: number, index: number) => Promise<void>
  /** Resolves with where the file actually landed, which a collision can change. */
  saveAttachment: (messageId: number, index: number, destination: string) => Promise<string>
  /**
   * What this conversation fetches unasked. Sending `none` is not the same as never calling
   * this: the call is what records that the question was asked, and only an unanswered one
   * should prompt again.
   */
  setAutoDownload: (id: ConversationId, mode: AutoDownload) => Promise<void>
  /**
   * Drops a conversation's loaded history and everything hanging off it.
   *
   * Called when a screen stops showing one. A window that outlived its screen was both a leak -
   * every conversation ever opened kept its full page for the session - and a lie about
   * transfers, since reports for a loaded window are recorded whether or not anything draws them.
   */
  forgetHistory: (id: ConversationId) => void
  /** Where libsession caches downloads, and how much of it they may take. */
  getCacheSettings: () => Promise<{ cacheDir: string; limit: number | undefined }>
  setAttachmentCacheLimit: (bytes?: number) => Promise<void>
  dispose: () => void
}

export type SessionStore = StoreApi<SessionState> & { actions: SessionActions }

/**
 * How much the reader is meant to care.
 *
 * Passed as an argument rather than split into four functions, because an app maps every level
 * to a console call in one place, and a level added later would otherwise be a breaking change
 * for every implementation.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface SessionStoreOptions {
  /**
   * Where a line of diagnostic text goes.
   *
   * Injected rather than assumed: this package typechecks with no DOM and no node types, so
   * `console` is not declared here - and that is the environment split working rather than an
   * inconvenience, because which console a line reaches is a per-platform question. Each app
   * passes its own; leaving it out is silence.
   */
  log?: (level: LogLevel, line: string) => void
  /**
   * How much disk the attachment cache may occupy, in bytes. Left out means no limit, which is
   * libsession's default and is how a cache eats a disk - so every app should pass one, and what
   * it should be is a per-platform question a phone and a desktop answer differently.
   */
  attachmentCacheLimit?: number
}

/**
 * libsession's levels onto the app's.
 *
 * libsession has two the app does not: `trace`, which is a louder `debug`, and `critical`,
 * which is an `error` nobody recovers from. Neither earns a console method of its own, and the
 * original level is still in the line itself.
 */
function appLevel(level: string): LogLevel {
  switch (level) {
    case 'info':
      return 'info'
    case 'warn':
      return 'warn'
    case 'error':
    case 'critical':
      return 'error'
    default:
      return 'debug'
  }
}

const PAGE = 30

export function createSessionStore(
  client: SessionClient,
  options: SessionStoreOptions = {},
): SessionStore {
  const log = options.log ?? ((): void => undefined)
  const store = createStore<SessionState>(() => ({ ...emptyState }))

  const unsubscribe = client.onEvent((event) => {
    // libsession's own logging, when the bridge was asked for it. Passed straight through
    // rather than stored: it is not state, and it is the only place the *reason* for a send
    // that ends in `failed` shows up - the state machine reports what happened, never why.
    if (event.type === 'log') {
      log(appLevel(event.level), `[libsession ${event.level}] ${event.category}: ${event.message}`)
      return
    }
    store.setState((state) => applyEvent(state, event))
  })

  function patchWindow(id: ConversationId, patch: Partial<MessageWindow>): void {
    store.setState((state) => {
      const current: MessageWindow = state.histories[id] ?? {
        ready: false,
        messages: [],
        exhausted: false,
        fetching: false,
      }
      return { histories: { ...state.histories, [id]: { ...current, ...patch } } }
    })
  }

  function windowFrom(messages: Message[], previous: Message[] = []): Partial<MessageWindow> {
    const all = mergePages(messages, previous)
    const oldest = all[0]
    return {
      ready: true,
      fetching: false,
      messages: all,
      exhausted: messages.length < PAGE,
      ...(oldest === undefined
        ? {}
        : { oldestCursor: { timestamp: oldest.timestamp, id: oldest.id } }),
    }
  }

  /**
   * Runs an onboarding step and says so when it fails.
   *
   * The screens flatten every refusal here into one sentence, because there is nothing useful to
   * tell somebody halfway through making an account. Right for the screen, and it leaves nobody
   * able to say *what* failed. The rejection still propagates; this only makes sure it was heard.
   *
   * It wraps the **whole** action, re-hydrate included, because the call that throws is as often
   * the read-back afterwards as the bridge call itself.
   */
  async function onboardingStep<T>(name: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run()
    } catch (error) {
      log(
        'error',
        `[session] ${name} failed: ${error instanceof Error ? error.message : String(error)}`,
      )
      throw error
    }
  }

  const actions: SessionActions = {
    async start(): Promise<void> {
      store.setState({ startupError: null })
      try {
        await actions.hydrate()
      } catch (error) {
        // **The one place a failed start is allowed to end up.** Everything that can go wrong
        // between the app opening and libsession answering throws, and every one of those throws
        // arrives here -- which is what makes "it did not start" a state the screens can render
        // rather than a promise nobody was holding. Left uncaught it was an unhandled rejection
        // and a launch screen that never went away, identical from the outside to a slow start.
        const message = error instanceof Error ? error.message : String(error)
        log('error', `[session] could not start: ${message}`)
        store.setState({ startupError: message })
      }
    },

    async clearDeviceData(): Promise<void> {
      // The same call onboarding's back uses: the database, its journals and the attachment cache
      // are removed and a fresh one is opened. What follows is a device with no account on it,
      // which is where somebody restores from their recovery phrase -- so this is both of the
      // legacy client's options, clear and clear-then-restore, which differ there only in what
      // they do next.
      await client.discardAccount()
      store.setState({ ...emptyState })
      await actions.start()
    },

    async getPreference(key): Promise<string | undefined> {
      // Undefined rather than a throw when there is no account yet: every caller would otherwise
      // have to ask whether hydrate has happened before it could ask anything else.
      if (store.getState().account?.haveAccount !== true) return undefined
      return client.getPref(key)
    },

    async setPreference(key, value): Promise<void> {
      if (store.getState().account?.haveAccount !== true) return
      await client.setPref(key, value)
    },

    async hydrate(): Promise<void> {
      if (options.attachmentCacheLimit !== undefined) {
        await client.setAttachmentCacheLimit(options.attachmentCacheLimit)
      }

      const account = await client.getAccountInfo()
      store.setState({ account })

      // Logged, not just held, because the account ID is what someone else needs in order to
      // write to this device, and reading it off a screen is not always possible - a headless
      // e2e run, a device you are tailing logs from. One line, on every platform, from the one
      // place that learns it. `run`'s references say where each platform's console ends up.
      log(
        'info',
        account.haveAccount
          ? `[session] account ${account.sessionId ?? '(no id)'}, network ${
              account.networkAttached ? 'attached' : 'not attached'
            }`
          : '[session] no account on this device yet',
      )

      if (!account.haveAccount) {
        // **Everything derived goes, not just the account.** `setState` merges, so setting only
        // the account left the previous one's conversations, requests and message windows sitting
        // in the store -- which is fine on a first launch, where there were none, and is a leak
        // between accounts the moment onboarding can be backed out of and started again.
        store.setState({ ...emptyState, account, hydrated: true })
        return
      }

      const [conversations, requests] = await Promise.all([
        client.getConversations(),
        client.getMessageRequests(),
      ])

      store.setState({ conversations, requests, hydrated: true })
    },

    async loadHistory(id): Promise<void> {
      const existing = store.getState().histories[id]
      if (existing?.fetching) return
      patchWindow(id, { fetching: true })
      const page = await client.getMessages(id, { limit: PAGE })
      patchWindow(id, windowFrom(page.messages))
    },

    async loadOlder(id): Promise<void> {
      const window = store.getState().histories[id]
      if (!window || window.fetching || window.exhausted || !window.oldestCursor) return

      patchWindow(id, { fetching: true })
      const page = await client.getMessages(id, { limit: PAGE, before: window.oldestCursor })
      patchWindow(id, windowFrom(page.messages, store.getState().histories[id]?.messages ?? []))
    },

    forgetHistory(id): void {
      store.setState((state) => {
        const { [id]: dropped, ...histories } = state.histories
        if (dropped === undefined) return state
        return { histories, transfers: withoutHistory(state.transfers, dropped.messages) }
      })
    },

    async send(id, body, replyTo): Promise<void> {
      // No optimistic row: libsession stores the message before this resolves and announces
      // it as message-added, so inventing one here would only produce a duplicate to
      // reconcile.
      await client.sendMessage(id, { body, ...(replyTo === undefined ? {} : { replyTo }) })
    },

    async markRead(id): Promise<void> {
      await client.markRead(id)
    },

    async approve(id): Promise<void> {
      await client.approveConversation(id)
    },

    async startConversation(accountId): Promise<ConversationId> {
      const trimmed = accountId.trim()
      // libsession validates the id and throws on a malformed one, which is the error the
      // caller wants - there is nothing useful this layer could add by checking first.
      return client.openDm(trimmed)
    },

    async retry(messageId): Promise<boolean> {
      return client.retrySend(messageId)
    },

    async downloadAttachment(messageId, index): Promise<void> {
      await client.downloadAttachment(messageId, index)
    },

    async saveAttachment(messageId, index, destination): Promise<string> {
      return client.saveAttachment(messageId, index, destination)
    },

    async setAutoDownload(id, mode): Promise<void> {
      await client.setAutoDownload(id, mode)
    },

    async getCacheSettings(): Promise<{ cacheDir: string; limit: number | undefined }> {
      const [cacheDir, limit] = await Promise.all([
        client.getCacheDir(),
        client.getAttachmentCacheLimit(),
      ])
      return { cacheDir, limit }
    },

    async setAttachmentCacheLimit(bytes): Promise<void> {
      await client.setAttachmentCacheLimit(bytes)
    },

    async createAccount(): Promise<void> {
      await onboardingStep('createAccount', async () => {
        await client.createAccount()
        await actions.hydrate()
      })
    },

    async restoreAccount(from): Promise<void> {
      await onboardingStep('restoreAccount', async () => {
        await client.restoreAccount(from)
        await actions.hydrate()
      })
    },

    async checkRecoveryPhrase(words, language): Promise<void> {
      await client.checkRecoveryPhrase(words, language)
    },

    async discardAccount(): Promise<void> {
      await onboardingStep('discardAccount', async () => {
        await client.discardAccount()
        await actions.hydrate()
      })
    },

    async keepAccount(): Promise<void> {
      await onboardingStep('keepAccount', () => client.keepAccount())
    },

    async refreshAccount(): Promise<void> {
      store.setState({ account: await client.getAccountInfo() })
    },

    async setDisplayName(name): Promise<void> {
      await onboardingStep('setDisplayName', async () => {
        await client.setDisplayName(name)
        await actions.hydrate()
      })
    },

    dispose(): void {
      unsubscribe()
    },
  }

  return Object.assign(store, { actions })
}
