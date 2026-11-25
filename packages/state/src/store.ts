import type {
  AttachmentRef,
  AutoDownload,
  ConfigSize,
  ConversationId,
  Message,
  MessagePage,
  NetworkPaths,
  NotificationContent,
  NotificationSound,
  OutgoingMessage,
  SendPlan,
  SessionClient,
} from '@session/client'
import { MESSAGE_NOT_FOUND, SessionClientError } from '@session/client'
import { createStore, type StoreApi } from 'zustand/vanilla'

import { applyEvent, mergePages, recordRefusal, withoutHistory } from './applyEvent'
import { classifyStartupFailure, type StartupFailureKind } from './startupFailure'
import {
  emptyState,
  emptyWindow,
  MAX_JUMPS,
  type ListName,
  type MessageWindow,
  DELIVERY_MODES,
  type DeliveryMode,
  type SessionState,
  type StoredAppearance,
} from './types'

/** Where the account's theme and accent are kept, as libsession preferences. */
const THEME_PREF = 'appearance.theme'
const ACCENT_PREF = 'appearance.accent'
const NOTIFICATION_MODE_PREF = 'notifications.mode'

/** The device's notification switches, stored as `on` or `off`; see `SessionState`. */
const NOTIFICATION_SWITCH_PREFS = {
  soundWhenOpen: 'notifications.soundWhenOpen',
  notificationsShown: 'notifications.shown',
  audioNotifications: 'notifications.audio',
} as const

export type NotificationSwitch = keyof typeof NOTIFICATION_SWITCH_PREFS

function parseSwitch(stored: string | null | undefined): boolean | null {
  return stored === 'on' ? true : stored === 'off' ? false : null
}

/**
 * The stored delivery mode, or null for none. `fast` and `slow` are what builds before there were
 * four modes stored, and mean `instant` and `periodic`.
 */
function parseDeliveryMode(stored: string | null | undefined): DeliveryMode | null {
  if (stored === 'fast') return 'instant'
  if (stored === 'slow') return 'periodic'
  return DELIVERY_MODES.find((mode) => mode === stored) ?? null
}
/** Where the flags switched in Developer Settings are kept: a JSON object of name to value. */
const FLAG_TOGGLES_PREF = 'developer.flagToggles'

/**
 * The stored switched flags, or none where the stored value is missing or is not an object of
 * booleans: a malformed developer setting must not stop the account from opening.
 */
function parseFlagToggles(stored: string | undefined): Record<string, boolean> {
  if (stored === undefined) return {}
  try {
    const parsed: unknown = JSON.parse(stored)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, boolean] => typeof entry[1] === 'boolean',
      ),
    )
  } catch {
    return {}
  }
}

/** What the recovery password screen shows: the words, and the seed its QR code carries. */
export interface RecoveryPassword {
  words: string[]
  seedHex: string
}

export interface CacheSettings {
  /** Empty when the bridge was opened without one. */
  cacheDir: string
  /** Undefined means no limit. */
  limitBytes: number | undefined
  usageBytes: number
}

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
   * recovery phrase, so nothing calls it without asking twice. A clear that fails sets
   * `startupError` to why, and rejects.
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
   * Each of the account's configs and its size, for an exported log's header. Empty with no
   * account; rejects where the bridge cannot answer, which a failed start is.
   */
  getConfigSizes: () => Promise<ConfigSize[]>
  /** Every path the network holds open, for the path screen to poll while it is showing. */
  getNetworkPaths: () => Promise<NetworkPaths>
  /**
   * Stores the account's theme and accent and shows them. The rail's light/dark toggle calls it;
   * the Appearance screen, once built, will too.
   */
  setAppearance: (appearance: StoredAppearance) => Promise<void>
  /** Stores how new messages reach this device. See `deliveryMode`. */
  setDeliveryMode: (mode: DeliveryMode) => Promise<void>
  /** Stores what notifications show, in libsession's local settings. */
  setNotificationContent: (content: NotificationContent) => Promise<void>
  /** Stores the sound iOS notifications play, in libsession's local settings. */
  setNotificationSound: (sound: NotificationSound) => Promise<void>
  /** Stores one of the device's notification switches. */
  setNotificationSwitch: (name: NotificationSwitch, value: boolean) => Promise<void>
  /**
   * The recovery password, handed straight to the caller and never kept in the store: a string in
   * JavaScript cannot be wiped, so the fewer places hold it the better, and none of them a log.
   */
  getRecoveryPassword: () => Promise<RecoveryPassword>
  /** Hides the recovery password on this device for good. See `recoveryPasswordHidden`. */
  hideRecoveryPassword: () => Promise<void>
  /**
   * Switches a feature flag in Developer Settings, or with null puts it back to the environment's
   * value or the default. Stored with the account; see `flagToggles`.
   */
  setFlagToggle: (name: string, value: boolean | null) => Promise<void>
  /**
   * Replaces every switched flag at once, in one write: for putting them back together, as turning
   * debug mode off does.
   */
  replaceFlagToggles: (toggles: Readonly<Record<string, boolean>>) => Promise<void>
  /**
   * Subscribes first, then asks - never the other way round.
   *
   * What arrives before an answer is already in it, and what arrives after is applied on top of
   * it: responses and events share one ordered stream. Asking first and subscribing after is
   * what loses a change that lands in the gap.
   */
  hydrate: () => Promise<void>
  /**
   * Reads the newest page into a window that has none. A read that fails is logged and marks the
   * window `firstPageFailed` rather than rejecting.
   */
  /**
   * `openAt`: a message to open on, as a tapped notification names it. The first window is read
   * around it and lands on it; the newest page instead where it is not there to land on.
   */
  loadHistory: (id: ConversationId, openAt?: number) => Promise<void>
  /**
   * The page before the window's oldest message, joined to it; nothing while one is out. A read
   * that fails is logged and marks the window `olderPageFailed` rather than rejecting.
   */
  loadOlder: (id: ConversationId) => Promise<void>
  /**
   * The page after the window's newest message, for a window that does not reach the newest. A
   * read that fails is logged and marks the window `newerPageFailed` rather than rejecting.
   */
  loadNewer: (id: ConversationId) => Promise<void>
  /**
   * Puts the reader on a message: `landing` names it, and where the window does not hold it the
   * window is replaced by one read around it. `from` is the reply whose quote was followed, kept
   * as the way back.
   *
   * `absent`, changing nothing, where the message is not there to land on: deleted, or gone by
   * the time it is read. `superseded` where a later jump, or leaving the conversation, took the
   * window while the read was out: it then lands nowhere, and nothing is wrong.
   */
  jumpToMessage: (id: ConversationId, messageId: number, from?: number) => Promise<JumpOutcome>
  /**
   * Walks back one jump, landing on the reply it started from and reading a window around it
   * where it is no longer held. A reply deleted since is skipped for the one before it. A read
   * that fails rejects and keeps the jump, for the next press.
   */
  returnFromJump: (id: ConversationId) => Promise<void>
  /**
   * Forgets the way back: the latest jump alone, once its reply is back on screen by other means,
   * or with `all`, every jump, once the reader is back at the newest message.
   */
  forgetJumps: (id: ConversationId, which: 'latest' | 'all') => void
  /**
   * Replaces a window that does not reach the newest message with the newest page. With
   * `evenWhenHeld`, a window that does reach it is replaced too, dropping the pages above.
   */
  showNewest: (
    id: ConversationId,
    options?: { evenWhenHeld?: boolean | undefined },
  ) => Promise<void>
  /**
   * Rejects, storing nothing, when libsession refuses it: a file that cannot be read, say. Once
   * stored, the window shows the newest page, where the message is, and forgets its jumps.
   */
  send: (id: ConversationId, message: OutgoingMessage) => Promise<void>
  /** What sending the file at `path` would do with it: whether the composer may stage it. */
  attachmentSendPlan: (path: string, contentType?: string) => Promise<SendPlan>
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
   * Shows a message as a gallery or as a list, stored by libsession. The message redraws when the
   * change is announced, so nothing is patched here; false is a gallery libsession refused.
   */
  setGallery: (messageId: number, gallery: boolean) => Promise<boolean>
  /**
   * Fetches an attachment: one that is already cached resolves at once and reports nothing at
   * all. Whether the bytes are here is the attachment's `availability`, not this.
   *
   * Progress arrives as events, so nothing is returned: a row that mounts halfway through a
   * transfer reads the same state as one that started it.
   */
  downloadAttachment: (ref: AttachmentRef) => Promise<void>
  /**
   * Writes an attachment out to a path the person chose. Resolves with where it landed, which a
   * collision can change.
   */
  exportAttachment: (ref: AttachmentRef, destination: string) => Promise<string>
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
  /** Where libsession caches downloads, how much of it they may take, and how much they do. */
  getCacheSettings: () => Promise<CacheSettings>
  dispose: () => void
}

/** How a jump ended. See `SessionActions.jumpToMessage`. */
export type JumpOutcome = 'landed' | 'absent' | 'superseded'

export type SessionStore = StoreApi<SessionState> & { actions: SessionActions }

/**
 * How much the reader is meant to care: libsession's six levels, so a line keeps the level it was
 * logged at all the way to the file. Folding `critical` into `error` on the way through was what
 * an adapter used to do, and it erased the one distinction a crash report needed.
 *
 * Passed as an argument rather than split into six functions, because an app maps every level in
 * one place, and a level added later would otherwise be a breaking change for every
 * implementation.
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'critical'

export interface SessionStoreOptions {
  /**
   * Where a line of diagnostic text goes.
   *
   * Injected rather than assumed: this package typechecks with no DOM and no node types, so
   * `console` is not declared here - and that is the environment split working rather than an
   * inconvenience, because which console a line reaches is a per-platform question. Each app
   * passes its own; leaving it out is silence.
   */
  log?: (level: LogLevel, category: string, message: string, op?: string) => void
  /**
   * libsession's own lines, as it sent them: its level name, its category, and the message with
   * its prefix still on. Apart from `log` because reading that prefix is the logging package's
   * job, which this one does not depend on. Leaving it out drops them, which is what the desktop
   * renderer wants: main logs libsession's lines where they arrive.
   */
  libsessionLog?: (level: string, category: string, message: string) => void
  /**
   * How much disk the attachment cache may occupy, in bytes. Left out means no limit, which is
   * libsession's default and is how a cache eats a disk - so every app should pass one, and what
   * it should be is a per-platform question a phone and a desktop answer differently.
   */
  attachmentCacheLimitBytes?: number
}

const PAGE = 30
/**
 * What a conversation opens on: about two screens, so the first draw is short. Every row of it is
 * drawn before the transcript is shown, and the page before is read once the start is in reach.
 */
const FIRST_PAGE = 15
/**
 * What a jump reads around the message it lands on: about a page either side, so even a tall
 * window lands with rows held beyond what it shows, rather than asking for a page each way at
 * once. Every row of it is drawn again, which on a phone is about 120 ms more than one page.
 */
const JUMP_WINDOW = 2 * PAGE
const LIST_NAMES: readonly ListName[] = ['conversations', 'requests']

export function createSessionStore(
  client: SessionClient,
  options: SessionStoreOptions = {},
): SessionStore {
  const log = options.log ?? ((): void => undefined)
  const store = createStore<SessionState>(() => ({ ...emptyState }))

  /**
   * One list, read and stored the moment it is answered, which also puts it back in step.
   *
   * A placement is relative to the list it lands on, so it has to land on the answer it came
   * after. Responses and events share one ordered stream, and every transport delivers each frame
   * as its own callback with the microtask queue drained in between, so storing an answer in the
   * continuation of its own promise puts it under everything that followed it. Waiting for a
   * second answer first would let a placement that arrived in between land on the old list and
   * then be overwritten.
   */
  async function readList(list: ListName): Promise<void> {
    if (list === 'conversations') {
      const conversations = await client.getConversations()
      store.setState((state) => ({
        conversations,
        listsOutOfStep: { ...state.listsOutOfStep, conversations: false },
      }))
    } else {
      const requests = await client.getMessageRequests()
      store.setState((state) => ({
        requests,
        listsOutOfStep: { ...state.listsOutOfStep, requests: false },
      }))
    }
  }

  /**
   * A read already running is not asked again: the placement that failed during it came before
   * its answer on the stream, so the answer already covers it.
   */
  const rereading = new Set<ListName>()
  function rereadListsOutOfStep(): void {
    const { listsOutOfStep } = store.getState()
    for (const list of LIST_NAMES) {
      if (!listsOutOfStep[list] || rereading.has(list)) continue
      rereading.add(list)
      readList(list)
        .catch((error: unknown) => {
          log('warn', 'session', `could not read the ${list} list again: ${String(error)}`)
        })
        .finally(() => rereading.delete(list))
    }
  }

  // A read is the window's only while nothing has replaced or forgotten that window since it was
  // asked for: a page landing after a forget or a history-replaced must not bring the window back,
  // even when a new load for the same id has started since (StrictMode's mount, cleanup, mount),
  // and a page read beside one window must not be joined to the next.
  const generations = new Map<ConversationId, number>()
  const generationOf = (id: ConversationId): number => generations.get(id) ?? 0
  /** Makes every read still out for `id` land nowhere, and answers the generation after them. */
  function supersede(id: ConversationId): number {
    const next = generationOf(id) + 1
    generations.set(id, next)
    return next
  }

  /** Per conversation, one map per read of its history that is out: what was announced since. */
  const heardDuringReads = new Map<ConversationId, Set<Map<number, Message>>>()

  /**
   * Runs a read of a conversation's history, then applies again every message announced while it
   * was out. A message stored after the read executed is not in its page, and one past the end of
   * a window that does not reach the newest message, or of no window yet, was turned away by
   * `applyEvent`: once the page has landed, the window decides afresh where each belongs. Every
   * event carries a whole message, so applying one twice is harmless.
   */
  async function whileReading<T>(id: ConversationId, read: () => Promise<T>): Promise<T> {
    const heard = new Map<number, Message>()
    const reads = heardDuringReads.get(id) ?? new Set()
    reads.add(heard)
    heardDuringReads.set(id, reads)
    try {
      return await read()
    } finally {
      reads.delete(heard)
      if (reads.size === 0) heardDuringReads.delete(id)
      if (heard.size > 0) {
        const messages = [...heard.values()]
        store.setState((state) => applyEvent(state, { type: 'messages-updated', messages }))
      }
    }
  }

  const unsubscribe = client.onEvent((event) => {
    // libsession's own logging, when the bridge was asked for it. Passed straight through
    // rather than stored: it is not state, and it is the only place the *reason* for a send
    // that ends in `failed` shows up - the state machine reports what happened, never why.
    if (event.type === 'log') {
      options.libsessionLog?.(event.level, event.category, event.message)
      return
    }
    if (event.type === 'messages-added' || event.type === 'messages-updated') {
      for (const message of event.messages)
        for (const heard of heardDuringReads.get(message.conversationId) ?? [])
          heard.set(message.id, message)
    }
    // The window is dropped and read again: a page read before it may hold messages deleted since,
    // or leave a hole joined to the new one.
    if (event.type === 'history-replaced') supersede(event.conversationId)
    store.setState((state) => applyEvent(state, event))
    // Before the first read a placement has nothing to land on, and that read clears it.
    if (store.getState().hydrated) rereadListsOutOfStep()
  })

  let landings = 0

  function patchWindow(id: ConversationId, patch: Partial<MessageWindow>): void {
    store.setState((state) => ({
      histories: {
        ...state.histories,
        [id]: { ...(state.histories[id] ?? emptyWindow), ...patch },
      },
    }))
  }

  /** The jumps with one more, and the landing it made. */
  function landed(jumps: readonly number[], messageId: number, from?: number) {
    landings += 1
    return {
      landing: { messageId, serial: landings },
      jumps: from === undefined ? jumps : [...jumps, from].slice(-MAX_JUMPS),
    }
  }

  /**
   * The window as a page read it, in place of whatever was held, keeping the jumps. With `land`,
   * the landing is part of the same update: a screen never sees the new window without it.
   */
  function replaceWindow(
    id: ConversationId,
    page: MessagePage,
    land?: { messageId: number; from: number | undefined },
  ): void {
    store.setState((state) => {
      const previous = state.histories[id] ?? emptyWindow
      const kept = new Set(page.messages.map((m) => m.id))
      const window: MessageWindow = {
        ready: true,
        messages: page.messages,
        hasOlder: page.hasOlder,
        hasNewer: page.hasNewer,
        fetching: false,
        firstPageFailed: false,
        fetchingOlder: false,
        olderPageFailed: false,
        fetchingNewer: false,
        newerPageFailed: false,
        jumps: previous.jumps,
        ...(land === undefined ? {} : landed(previous.jumps, land.messageId, land.from)),
      }
      return {
        histories: { ...state.histories, [id]: window },
        transfers: withoutHistory(
          state.transfers,
          previous.messages.filter((m) => !kept.has(m.id)),
        ),
      }
    })
  }

  function land(id: ConversationId, messageId: number, from?: number): void {
    patchWindow(id, landed(store.getState().histories[id]?.jumps ?? [], messageId, from))
  }

  /**
   * The window read around `messageId`, or null where it is not there to land on: deleted, purged,
   * or never received.
   */
  async function windowAround(id: ConversationId, messageId: number): Promise<MessagePage | null> {
    let page: MessagePage
    try {
      page = await client.getMessages(id, { limit: JUMP_WINDOW, around: messageId })
    } catch (error) {
      if (error instanceof SessionClientError && error.code === MESSAGE_NOT_FOUND) return null
      throw error
    }
    const held = page.messages.find((m) => m.id === messageId)
    return held === undefined || held.deleted !== undefined ? null : page
  }

  /**
   * Makes every read still out for `id` land nowhere, ahead of one that may replace the window.
   * `resume` asks again for the pages that were on their way, for when that read leaves the window
   * as it was: their ends would otherwise wait for a scroll, with no Retry row to press.
   */
  function interruptPaging(id: ConversationId): { generation: number; resume: () => void } {
    const window = store.getState().histories[id]
    const older = window?.fetchingOlder === true
    const newer = window?.fetchingNewer === true
    const generation = supersede(id)
    patchWindow(id, { fetchingOlder: false, fetchingNewer: false })
    return {
      generation,
      resume: () => {
        if (generationOf(id) !== generation) return
        // Each logs and marks its own failure.
        if (older) void actions.loadOlder(id)
        if (newer) void actions.loadNewer(id)
      },
    }
  }

  /** Lands on a message, reading a window around it where the one held lacks it. */
  async function reveal(
    id: ConversationId,
    messageId: number,
    from?: number,
  ): Promise<JumpOutcome> {
    const window = store.getState().histories[id]
    if (window?.ready !== true) return 'superseded'
    const held = window.messages.find((m) => m.id === messageId)
    if (held !== undefined) {
      if (held.deleted !== undefined) return 'absent'
      land(id, messageId, from)
      return 'landed'
    }
    const { generation, resume } = interruptPaging(id)
    return whileReading(id, async (): Promise<JumpOutcome> => {
      let page: MessagePage
      try {
        page = await client.getMessages(id, { limit: JUMP_WINDOW, around: messageId })
      } catch (error) {
        resume()
        // Purged since the reply was drawn: not there to land on, as a deleted one is not.
        if (error instanceof SessionClientError && error.code === MESSAGE_NOT_FOUND)
          return generationOf(id) === generation ? 'absent' : 'superseded'
        throw error
      }
      if (generationOf(id) !== generation) return 'superseded'
      // A deleted message places the window and is left out of it.
      if (!page.messages.some((m) => m.id === messageId)) {
        resume()
        return 'absent'
      }
      replaceWindow(id, page, { messageId, from })
      return 'landed'
    })
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
        'session',
        `${name} failed: ${error instanceof Error ? error.message : String(error)}`,
      )
      throw error
    }
  }

  /** A refusal as the failure screen takes it: libsession's words, and what kind they are. */
  function startupFailure(error: unknown): { message: string; kind: StartupFailureKind } {
    const message = error instanceof Error ? error.message : String(error)
    const code = error instanceof SessionClientError ? error.code : undefined
    return { message, kind: classifyStartupFailure(message, code) }
  }

  /**
   * The switched flags are one stored value, so each write starts from the last one's result: a
   * write that read the set while another was still storing would put back what that one changed.
   * A failed write rejects its own caller and leaves the next to start from the store as it stands.
   */
  let flagTogglesWritten: Promise<void> = Promise.resolve()
  function writeFlagToggles(
    next: (current: Readonly<Record<string, boolean>>) => Readonly<Record<string, boolean>>,
  ): Promise<void> {
    const write = flagTogglesWritten.then(async () => {
      if (store.getState().account?.haveAccount !== true) return
      const flagToggles = next(store.getState().flagToggles)
      await client.setPref(FLAG_TOGGLES_PREF, JSON.stringify(flagToggles))
      store.setState({ flagToggles })
    })
    flagTogglesWritten = write.catch(() => undefined)
    return write
  }

  const actions: SessionActions = {
    async start(): Promise<void> {
      store.setState({ startupError: null, startupFailureKind: null })
      try {
        await actions.hydrate()
      } catch (error) {
        // **The one place a failed start is allowed to end up.** Everything that can go wrong
        // between the app opening and libsession answering throws, and every one of those throws
        // arrives here -- which is what makes "it did not start" a state the screens can render
        // rather than a promise nobody was holding. Left uncaught it was an unhandled rejection
        // and a launch screen that never went away, identical from the outside to a slow start.
        const { message, kind } = startupFailure(error)
        log('error', 'session', `could not start (${kind}): ${message}`)
        store.setState({ startupError: message, startupFailureKind: kind })
      }
    },

    async clearDeviceData(): Promise<void> {
      // The same call onboarding's back uses: the database, its journals and the attachment cache
      // are removed and a fresh one is opened. What follows is a device with no account on it,
      // which is where somebody restores from their recovery phrase -- so this is both of the
      // legacy client's options, clear and clear-then-restore, which differ there only in what
      // they do next.
      try {
        await client.discardAccount()
      } catch (error) {
        // A failed clear is a failed start by another name: the database is closed or gone and
        // nothing above it can carry on, so it lands where every other one does, with its own
        // reason. Rejects as well, so a caller that goes on to something only a clear allows --
        // ending the process -- does not.
        const { message, kind } = startupFailure(error)
        log('error', 'session', `could not clear the device (${kind}): ${message}`)
        store.setState({ startupError: message, startupFailureKind: kind })
        throw error
      }
      store.setState({ ...emptyState })
      await actions.start()
    },

    getConfigSizes(): Promise<ConfigSize[]> {
      return client.getConfigSizes()
    },

    getNetworkPaths(): Promise<NetworkPaths> {
      return client.getNetworkPaths()
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
      if (options.attachmentCacheLimitBytes !== undefined) {
        await client.setAttachmentCacheLimit(options.attachmentCacheLimitBytes)
      }

      const account = await client.getAccountInfo()
      const attachmentUploadLimitBytes = await client.getAttachmentUploadLimit()
      store.setState({ account, attachmentUploadLimitBytes })

      // Logged, not just held, because the account ID is what someone else needs in order to
      // write to this device, and reading it off a screen is not always possible - a headless
      // e2e run, a device you are tailing logs from. One line, on every platform, from the one
      // place that learns it. `run`'s references say where each platform's console ends up.
      log(
        'info',
        'session',
        account.haveAccount
          ? `account ${account.sessionId ?? '(no id)'}, network ${
              account.networkAttached ? 'attached' : 'not attached'
            }`
          : 'no account on this device yet',
      )

      // Applied the moment it is answered rather than with the lists below: a status event that
      // lands while those are still loading is newer than this answer and must stay on top of it.
      const askNetworkStatus = async (): Promise<void> => {
        const networkStatus = await client.getNetworkStatus()
        store.setState({ networkStatus })
      }

      if (!account.haveAccount) {
        // **Everything derived goes, not just the account.** `setState` merges, so setting only
        // the account left the previous one's conversations, requests and message windows sitting
        // in the store -- which is fine on a first launch, where there were none, and is a leak
        // between accounts the moment onboarding can be backed out of and started again.
        store.setState({ ...emptyState, account, hydrated: true })
        await askNetworkStatus()
        return
      }

      const [
        theme,
        accent,
        hidden,
        toggles,
        mode,
        content,
        notificationSound,
        sound,
        shown,
        audio,
      ] = await Promise.all([
        client.getPref(THEME_PREF),
        client.getPref(ACCENT_PREF),
        client.getRecoveryPasswordHidden(),
        client.getPref(FLAG_TOGGLES_PREF),
        client.getPref(NOTIFICATION_MODE_PREF),
        client.getNotificationContent(),
        client.getNotificationSound(),
        client.getPref(NOTIFICATION_SWITCH_PREFS.soundWhenOpen),
        client.getPref(NOTIFICATION_SWITCH_PREFS.notificationsShown),
        client.getPref(NOTIFICATION_SWITCH_PREFS.audioNotifications),
        readList('conversations'),
        readList('requests'),
        askNetworkStatus(),
      ])

      // In the same update as `hydrated`, so the screen the account opens on is drawn once, in its
      // theme and with its switched flags. Both or neither: an accent without its theme is half a
      // choice.
      const appearance = theme === undefined || accent === undefined ? null : { theme, accent }
      store.setState({
        appearance,
        recoveryPasswordHidden: hidden,
        flagToggles: parseFlagToggles(toggles),
        deliveryMode: parseDeliveryMode(mode),
        notificationContent: content,
        notificationSound,
        soundWhenOpen: parseSwitch(sound),
        notificationsShown: parseSwitch(shown),
        audioNotifications: parseSwitch(audio),
        hydrated: true,
      })
    },

    setFlagToggle(name, value): Promise<void> {
      return writeFlagToggles((current) => {
        const { [name]: _, ...rest } = current
        return value === null ? rest : { ...rest, [name]: value }
      })
    },

    replaceFlagToggles(toggles): Promise<void> {
      return writeFlagToggles(() => ({ ...toggles }))
    },

    async setAppearance(appearance): Promise<void> {
      if (store.getState().account?.haveAccount !== true) return
      await client.setPref(THEME_PREF, appearance.theme)
      await client.setPref(ACCENT_PREF, appearance.accent)
      store.setState({ appearance })
    },

    async setNotificationContent(content): Promise<void> {
      if (store.getState().account?.haveAccount !== true) return
      await client.setNotificationContent(content)
      store.setState({ notificationContent: content })
    },

    async setNotificationSound(sound): Promise<void> {
      if (store.getState().account?.haveAccount !== true) return
      await client.setNotificationSound(sound)
      store.setState({ notificationSound: sound })
    },

    async setNotificationSwitch(name, value): Promise<void> {
      if (store.getState().account?.haveAccount !== true) return
      await client.setPref(NOTIFICATION_SWITCH_PREFS[name], value ? 'on' : 'off')
      store.setState({ [name]: value })
    },

    async setDeliveryMode(mode): Promise<void> {
      if (store.getState().account?.haveAccount !== true) return
      await client.setPref(NOTIFICATION_MODE_PREF, mode)
      store.setState({ deliveryMode: mode })
    },

    async getRecoveryPassword(): Promise<RecoveryPassword> {
      const [words, seedHex] = await Promise.all([client.getSeedMnemonic(), client.getSeedHex()])
      // Hidden on this device: there is nothing to show, which the page reports as a failed load.
      if (words === null || seedHex === null) throw new Error('The recovery password is hidden')
      return { words, seedHex }
    },

    async hideRecoveryPassword(): Promise<void> {
      if (store.getState().account?.haveAccount !== true) return
      await client.hideRecoveryPassword()
      // Read back, not assumed: the page goes back to Settings only once it is gone for good.
      if (!(await client.getRecoveryPasswordHidden())) {
        throw new Error('The recovery password was not hidden')
      }
      store.setState({ recoveryPasswordHidden: true })
    },

    async loadHistory(id, openAt): Promise<void> {
      const existing = store.getState().histories[id]
      if (existing?.fetching) return
      patchWindow(id, { fetching: true, firstPageFailed: false })
      const generation = generationOf(id)
      await whileReading(id, async () => {
        let page: MessagePage
        try {
          const around = openAt === undefined ? null : await windowAround(id, openAt)
          if (around !== null && openAt !== undefined) {
            if (generationOf(id) !== generation) return
            replaceWindow(id, around, { messageId: openAt, from: undefined })
            return
          }
          page = await client.getMessages(id, { limit: FIRST_PAGE })
        } catch (error) {
          log('warn', 'session', `could not read a conversation's first page: ${String(error)}`)
          if (generationOf(id) === generation)
            patchWindow(id, { fetching: false, firstPageFailed: true })
          return
        }
        if (generationOf(id) !== generation) return
        replaceWindow(id, page)
      })
    },

    async loadOlder(id): Promise<void> {
      const window = store.getState().histories[id]
      const oldest = window?.messages[0]
      if (!window?.ready || window.fetchingOlder || !window.hasOlder || oldest === undefined) return

      patchWindow(id, { fetchingOlder: true, olderPageFailed: false })
      const generation = generationOf(id)
      await whileReading(id, async () => {
        let page: MessagePage
        try {
          page = await client.getMessages(id, {
            limit: PAGE,
            before: { timestamp: oldest.timestamp, id: oldest.id },
          })
        } catch (error) {
          log('warn', 'session', `could not read an older page: ${String(error)}`)
          // Free to ask again: a flag left set would end paging for as long as the window lives.
          if (generationOf(id) === generation)
            patchWindow(id, { fetchingOlder: false, olderPageFailed: true })
          return
        }
        if (generationOf(id) !== generation) return
        patchWindow(id, {
          fetchingOlder: false,
          hasOlder: page.hasOlder,
          messages: mergePages(page.messages, store.getState().histories[id]?.messages ?? []),
        })
      })
    },

    async loadNewer(id): Promise<void> {
      const window = store.getState().histories[id]
      const newest = window?.messages[window.messages.length - 1]
      if (!window?.ready || window.fetchingNewer || !window.hasNewer || newest === undefined) return

      patchWindow(id, { fetchingNewer: true, newerPageFailed: false })
      const generation = generationOf(id)
      await whileReading(id, async () => {
        let page: MessagePage
        try {
          page = await client.getMessages(id, {
            limit: PAGE,
            after: { timestamp: newest.timestamp, id: newest.id },
          })
        } catch (error) {
          log('warn', 'session', `could not read a newer page: ${String(error)}`)
          if (generationOf(id) === generation)
            patchWindow(id, { fetchingNewer: false, newerPageFailed: true })
          return
        }
        if (generationOf(id) !== generation) return
        patchWindow(id, {
          fetchingNewer: false,
          hasNewer: page.hasNewer,
          messages: mergePages(store.getState().histories[id]?.messages ?? [], page.messages),
        })
      })
    },

    jumpToMessage(id, messageId, from): Promise<JumpOutcome> {
      return reveal(id, messageId, from)
    },

    async returnFromJump(id): Promise<void> {
      for (;;) {
        const jumps = store.getState().histories[id]?.jumps ?? []
        const reply = jumps[jumps.length - 1]
        if (reply === undefined) return
        const rest = jumps.slice(0, -1)
        patchWindow(id, { jumps: rest })
        let outcome: JumpOutcome
        try {
          outcome = await reveal(id, reply)
        } catch (error) {
          log('warn', 'session', `could not walk back from a jump: ${String(error)}`)
          // Kept for the next press, unless the way back has changed since.
          if (store.getState().histories[id]?.jumps === rest) patchWindow(id, { jumps })
          throw error
        }
        // Deleted since: on to the reply before it. Anything else ends the walk.
        if (outcome !== 'absent') return
      }
    },

    forgetJumps(id, which): void {
      const jumps = store.getState().histories[id]?.jumps ?? []
      if (jumps.length === 0) return
      patchWindow(id, { jumps: which === 'all' ? [] : jumps.slice(0, -1) })
    },

    async showNewest(id, { evenWhenHeld = false } = {}): Promise<void> {
      const window = store.getState().histories[id]
      if (window?.ready !== true || (!window.hasNewer && !evenWhenHeld)) return
      const { generation, resume } = interruptPaging(id)
      await whileReading(id, async () => {
        const page = await client.getMessages(id, { limit: FIRST_PAGE }).catch((error: unknown) => {
          log('warn', 'session', `could not read the newest page: ${String(error)}`)
          resume()
          throw error
        })
        if (generationOf(id) !== generation) return
        replaceWindow(id, page)
      })
    },

    forgetHistory(id): void {
      supersede(id)
      store.setState((state) => {
        const { [id]: dropped, ...histories } = state.histories
        if (dropped === undefined) return state
        return { histories, transfers: withoutHistory(state.transfers, dropped.messages) }
      })
    },

    async send(id, message): Promise<void> {
      // No optimistic row: libsession stores the message before this resolves and announces
      // it as message-added, so inventing one here would only produce a duplicate to
      // reconcile.
      await client.sendMessage(id, message)
      if (store.getState().histories[id]?.ready !== true) return
      patchWindow(id, { jumps: [] })
      // The message is stored: a read that fails after it must not be reported as a refusal,
      // which keeps the draft and invites sending it twice. `showNewest` logs it.
      await actions.showNewest(id).catch(() => undefined)
    },

    attachmentSendPlan(path, contentType): Promise<SendPlan> {
      return client.attachmentSendPlan(path, contentType)
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

    async setGallery(messageId, gallery): Promise<boolean> {
      return client.setGallery(messageId, gallery)
    },

    async downloadAttachment(ref): Promise<void> {
      try {
        await client.downloadAttachment(ref.messageId, ref.index)
      } catch (error) {
        store.setState((state) => recordRefusal(state, 'download', ref))
        throw error
      }
    },

    async exportAttachment(ref, destination): Promise<string> {
      return client.exportAttachment(ref.messageId, ref.index, destination)
    },

    async setAutoDownload(id, mode): Promise<void> {
      await client.setAutoDownload(id, mode)
    },

    async getCacheSettings(): Promise<CacheSettings> {
      const [cacheDir, limitBytes, usageBytes] = await Promise.all([
        client.getCacheDir(),
        client.getAttachmentCacheLimit(),
        client.getAttachmentCacheSize(),
      ])
      return { cacheDir, limitBytes, usageBytes }
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
