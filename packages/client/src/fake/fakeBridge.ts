import { utf8Decode } from '@session/basic-types'
import type { Command, Frame, Request, Result } from '@session/bridge-types'

import { SessionClientError } from '../errors'
import type { BridgeTransport, SessionClient } from '../types'

/**
 * Speaks the bridge protocol on top of a plain SessionClient.
 *
 * Two things come out of this. The apps get to run against the fake through the same
 * correlation and transport path they will use for the real thing, so the skeleton exercises
 * everything except the C++. And the shim has a reference implementation to match: this file
 * is the protocol written out in a language that is easy to read.
 *
 * Handlers are dispatched one at a time and their answers are written to the same sink the
 * events go to, in the order they complete - the ordering guarantee the real shim gets from
 * running everything on Core's loop.
 */
export function createFakeTransport(client: SessionClient): BridgeTransport {
  let sink: ((frame: Frame) => void) | null = null

  const unsubscribe = client.onEvent((event) => {
    sink?.({ type: 'event', event })
  })

  function respond(
    id: number,
    outcome: { result: Result } | { error: string; code?: string },
  ): void {
    sink?.({ type: 'response', response: { id, ...outcome } })
  }

  return {
    send(request: Request): void {
      void handle(client, request.command)
        .then((result) => respond(request.id, { result }))
        .catch((error: unknown) => respond(request.id, refusal(error)))
    },

    setSink(onFrame: (frame: Frame) => void): void {
      sink = onFrame
    },

    close(): void {
      unsubscribe()
      sink = null
      client.close()
    },
  }
}

/** The error as the shim answers one: its text, and its dotted code where it carries one. */
function refusal(error: unknown): { error: string; code?: string } {
  if (!(error instanceof Error)) return { error: String(error) }
  const code = error instanceof SessionClientError ? error.code : undefined
  return code === undefined ? { error: error.message } : { error: error.message, code }
}

const empty: Result = { type: 'empty' }

/** Behaviour the fake has no model of; the real shim answers the same way outside a test build. */
function unsupported(name: string): never {
  throw new Error(`The fake bridge does not serve ${name}`)
}

type Handler<K extends Command['type']> = (
  client: SessionClient,
  command: Extract<Command, { type: K }>,
) => Promise<Result>

/**
 * The words back out of the bytes, splitting the way the real shim does.
 *
 * The fake mirrors the bridge, so it has to take the phrase in the same shape -- otherwise a
 * contract scenario proves the fake's decoding rather than the shim's.
 */
function phraseWords(phrase: Uint8Array): string[] {
  return utf8Decode(phrase).split(' ').filter(Boolean)
}

// One entry per command, keyed by its tag, so a command added to the protocol without a fake arm
// is a compile error rather than a request that fails only once a screen sends it.
const handlers: { [K in Command['type']]: Handler<K> } = {
  getAccountInfo: async (client) => ({ type: 'accountInfo', info: await client.getAccountInfo() }),
  createAccount: async (client) => {
    await client.createAccount()
    return empty
  },
  restoreAccountFromWords: async (client, cmd) => {
    await client.restoreAccount({
      words: phraseWords(cmd.phrase),
      ...(cmd.language === undefined ? {} : { language: cmd.language }),
    })
    return empty
  },
  checkRecoveryPhrase: async (client, cmd) => {
    await client.checkRecoveryPhrase(phraseWords(cmd.phrase), cmd.language)
    return empty
  },
  restoreAccountFromSeed: async (client, cmd) => {
    await client.restoreAccount({ hexSeed: cmd.hexSeed })
    return empty
  },
  discardAccount: async (client) => {
    await client.discardAccount()
    return empty
  },
  keepAccount: async (client) => {
    await client.keepAccount()
    return empty
  },
  getSeedMnemonic: async (client, cmd) => {
    const words = await client.getSeedMnemonic(cmd.language)
    return words === null ? { type: 'seedHidden' } : { type: 'mnemonic', words }
  },
  getSeedHex: async (client) => {
    const hex = await client.getSeedHex()
    return hex === null ? { type: 'seedHidden' } : { type: 'hex', hex }
  },
  hideRecoveryPassword: async (client) => {
    await client.hideRecoveryPassword()
    return empty
  },
  getRecoveryPasswordHidden: async (client) => ({
    type: 'bool',
    value: await client.getRecoveryPasswordHidden(),
  }),
  setDisplayName: async (client, cmd) => {
    await client.setDisplayName(cmd.name)
    return empty
  },
  attachNetwork: async (client, cmd) => {
    await client.attachNetwork({
      netid: cmd.netid,
      ...(cmd.seedNodes === undefined ? {} : { seedNodes: cmd.seedNodes }),
      ...(cmd.fileServer === undefined ? {} : { fileServer: cmd.fileServer }),
    })
    return empty
  },
  pollOnce: async (client) => {
    await client.pollOnce()
    return empty
  },
  warmNetworkCache: async (client) => ({
    type: 'bool',
    value: await client.warmNetworkCache(),
  }),
  getNetworkStatus: async (client) => ({
    type: 'networkStatus',
    status: await client.getNetworkStatus(),
  }),
  setPushToken: () => unsupported('setPushToken'),
  handlePushPayload: () => unsupported('handlePushPayload'),

  getConversations: async (client) => ({
    type: 'conversationList',
    conversations: await client.getConversations(),
  }),
  getMessageRequests: async (client) => ({
    type: 'conversationList',
    conversations: await client.getMessageRequests(),
  }),
  getConversation: async (client, cmd) => ({
    type: 'conversation',
    conversation: await client.getConversation(cmd.conversationId),
  }),
  openDm: async (client, cmd) => {
    const id = await client.openDm(cmd.sessionId)
    return { type: 'conversation', conversation: await client.getConversation(id) }
  },
  markRead: async (client, cmd) => {
    await client.markRead(cmd.conversationId, cmd.upTo)
    return empty
  },
  setPollInterval: async (client, cmd) => {
    await client.setPollInterval(cmd.intervalMs)
    return empty
  },
  setBlocked: async (client, cmd) => {
    await client.setBlocked(cmd.conversationId, cmd.blocked)
    return empty
  },
  setNickname: async (client, cmd) => {
    await client.setNickname(cmd.conversationId, cmd.nickname)
    return empty
  },
  setPriority: async (client, cmd) => {
    await client.setPriority(cmd.conversationId, cmd.priority)
    return empty
  },
  approveConversation: async (client, cmd) => {
    await client.approveConversation(cmd.conversationId)
    return empty
  },
  deleteConversation: async (client, cmd) => {
    await client.deleteConversation(cmd.conversationId, cmd.keepMessages)
    return empty
  },

  getMessages: async (client, cmd) => ({
    type: 'messagePage',
    ...(await client.getMessages(cmd.conversationId, {
      limit: cmd.limit,
      includeDeleted: cmd.includeDeleted,
      before: cmd.before,
      after: cmd.after,
      around: cmd.around,
    })),
  }),
  sendMessage: async (client, cmd) => ({
    type: 'messageId',
    messageId: await client.sendMessage(cmd.conversationId, {
      body: cmd.body,
      ...(cmd.replyTo === undefined ? {} : { replyTo: cmd.replyTo }),
      ...(cmd.attachments === undefined ? {} : { attachments: cmd.attachments }),
    }),
  }),
  retrySend: async (client, cmd) => ({
    type: 'bool',
    value: await client.retrySend(cmd.messageId),
  }),
  setGallery: async (client, cmd) => ({
    type: 'bool',
    value: await client.setGallery(cmd.messageId, cmd.gallery),
  }),
  deleteMessage: async (client, cmd) => {
    await client.deleteMessage(cmd.messageId, cmd.scope)
    return { type: 'bool', value: true }
  },

  downloadAttachment: async (client, cmd) => {
    await client.downloadAttachment(cmd.messageId, cmd.index)
    return empty
  },
  exportAttachment: async (client, cmd) => ({
    type: 'path',
    path: await client.exportAttachment(cmd.messageId, cmd.index, cmd.destination, {
      notifySender: cmd.notifySender,
      replace: cmd.replace,
    }),
  }),
  attachmentSendPlan: async (client, cmd) => ({
    type: 'sendPlan',
    plan: await client.attachmentSendPlan(cmd.path, cmd.contentType),
  }),
  setAutoDownload: async (client, cmd) => {
    await client.setAutoDownload(cmd.conversationId, cmd.mode)
    return empty
  },
  getCacheDir: async (client) => ({ type: 'path', path: await client.getCacheDir() }),
  getAttachmentUploadLimit: async (client) => ({
    type: 'byteCount',
    bytes: await client.getAttachmentUploadLimit(),
  }),
  getAttachmentCacheLimit: async (client) => {
    const bytes = await client.getAttachmentCacheLimit()
    return { type: 'byteCount', ...(bytes === undefined ? {} : { bytes }) }
  },
  setAttachmentCacheLimit: async (client, cmd) => {
    await client.setAttachmentCacheLimit(cmd.limitBytes)
    return empty
  },

  getAttachmentCacheSize: async (client) => ({
    type: 'byteCount',
    bytes: await client.getAttachmentCacheSize(),
  }),

  getThumbnailEdge: async (client) => ({ type: 'edge', edgePx: await client.getThumbnailEdge() }),
  setThumbnailEdge: async (client, cmd) => {
    await client.setThumbnailEdge(cmd.edgePx)
    return empty
  },
  getNetworkPaths: async (client) => ({
    type: 'networkPaths',
    snapshot: await client.getNetworkPaths(),
  }),
  getConfigSizes: async (client) => ({
    type: 'configSizes',
    sizes: await client.getConfigSizes(),
  }),

  getPref: async (client, cmd) => {
    const value = await client.getPref(cmd.key)
    return { type: 'pref', ...(value === undefined ? {} : { value }) }
  },
  setPref: async (client, cmd) => {
    await client.setPref(cmd.key, cmd.value)
    return empty
  },

  // The contract harness drives the fake through fixtures and a manual clock, not through these.
  deliverTestMessage: () => unsupported('deliverTestMessage'),
  getTestAccountSeed: () => unsupported('getTestAccountSeed'),
  approveTestContact: () => unsupported('approveTestContact'),
  echoTestFrame: () => unsupported('echoTestFrame'),
}

// async so that a handler throwing synchronously rejects like one that fails later.
async function handle(client: SessionClient, command: Command): Promise<Result> {
  const handler = handlers[command.type] as (c: SessionClient, cmd: Command) => Promise<Result>
  return handler(client, command)
}
