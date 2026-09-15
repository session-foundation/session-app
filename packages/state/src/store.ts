import type {
  AttachmentStatus,
  AutoDownload,
  ConversationId,
  Message,
  SessionClient,
} from '@session/client'
import { createStore, type StoreApi } from 'zustand/vanilla'

import { ATTACHMENT_OK } from '@session/client'

import { applyEvent, mergePages, withoutConversation } from './applyEvent'
import { emptyState, transferKey, type MessageWindow, type SessionState } from './types'

export interface SessionActions {
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

  /**
   * Whatever the page said its attachments were doing, before the window is marked ready.
   *
   * Seeded rather than left to the reports: a transfer has no stored state, so a window that
   * arrived without this would draw every attachment as untouched. Written first so that no
   * render happens between the messages appearing and their transfers being known.
   *
   * Only what a report cannot say: a `done` entry stands for a cached file that nothing is
   * fetching, which no event will ever announce.
   */
  function seedTransfers(id: ConversationId, statuses: AttachmentStatus[]): void {
    if (statuses.length === 0) return
    store.setState((state) => {
      const transfers = { ...state.transfers }
      for (const status of statuses) {
        const key = transferKey('download', status.messageId, status.index)
        if (status.transferring) {
          transfers[key] = {
            conversationId: id,
            state: 'running',
            done: status.done,
            total: status.total,
          }
        } else if (status.cached) {
          transfers[key] = {
            conversationId: id,
            state: 'done',
            done: 0,
            total: 0,
            result: ATTACHMENT_OK,
          }
        } else {
          // Nothing doing and nothing here: an entry would claim to know something the row
          // learns better from its absence.
          delete transfers[key]
        }
      }
      return { transfers }
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

  const actions: SessionActions = {
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
        store.setState({ hydrated: true })
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
      seedTransfers(id, page.transfers)
      patchWindow(id, windowFrom(page.messages))
    },

    async loadOlder(id): Promise<void> {
      const window = store.getState().histories[id]
      if (!window || window.fetching || window.exhausted || !window.oldestCursor) return

      patchWindow(id, { fetching: true })
      const page = await client.getMessages(id, { limit: PAGE, before: window.oldestCursor })
      seedTransfers(id, page.transfers)
      patchWindow(id, windowFrom(page.messages, store.getState().histories[id]?.messages ?? []))
    },

    forgetHistory(id): void {
      store.setState((state) => {
        const { [id]: dropped, ...histories } = state.histories
        if (dropped === undefined) return state
        return { histories, transfers: withoutConversation(state.transfers, id) }
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
      await client.createAccount()
      await actions.hydrate()
    },

    dispose(): void {
      unsubscribe()
    },
  }

  return Object.assign(store, { actions })
}
