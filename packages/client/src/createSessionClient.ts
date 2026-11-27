import { utf8Encode } from '@session/basic-types'
import type {
  AccountInfo,
  AutoDownload,
  Command,
  ConfigSize,
  Conversation,
  ConversationId,
  Deletion,
  Frame,
  NetworkPaths,
  NetworkStatus,
  NotificationContent,
  NotificationSound,
  Request,
  Response,
  Result,
  SendPlan,
  SessionEvent,
} from '@session/bridge-types'

import { isDatabaseKeyCode } from './databaseKey'
import { BridgeClosedError, SessionClientError } from './errors'
import { BRIDGE_UNAVAILABLE } from './refusingTransport'
import type {
  BridgeTransport,
  ClientClosed,
  MessagePage,
  OutgoingMessage,
  SessionClient,
  Unsubscribe,
} from './types'

type Pending = {
  resolve: (response: Response) => void
  reject: (error: Error) => void
  /**
   * Which command is waiting, kept only so a refusal can name it.
   *
   * libsession's messages describe the argument it would not take -- "Invalid conversation id" --
   * and say nothing about what was being asked. One of those surfaced as an unhandled rejection
   * during startup and the only way to find out which of the eight commands that take a
   * conversation id had sent it was to add this, so it stays.
   */
  command: Command['type']
}

type ResultOf<K extends Result['type']> = Extract<Result, { type: K }>

/**
 * A phrase as the bytes the bridge takes, joined by the single space the shim splits on.
 *
 * **The last place it is a string.** Everything above this has one already -- the field's value,
 * the state holding it, the array split out of it -- and none of those can be wiped. What this
 * buys is the copy that would otherwise cross into the other process, where the sender could
 * never reach it: the buffer is transferred rather than cloned, so it exists once and the shim
 * zeroes it.
 */
function phraseBytes(words: readonly string[]): Uint8Array {
  return utf8Encode(words.join(' '))
}

/**
 * Turns a transport into the client everything else is written against.
 *
 * Requests are submitted and forgotten; their answers come back on the same ordered stream as
 * the change events, tagged with the request id. That is what preserves libsession's ordering
 * across the boundary - see `Frame` in @session/bridge-types for why it is not two channels.
 */
export function createSessionClient(transport: BridgeTransport): SessionClient {
  let nextRequestId = 1
  let closed = false
  const pending = new Map<number, Pending>()
  const listeners = new Set<(event: SessionEvent) => void>()

  transport.setSink((frame: Frame) => {
    if (frame.type === 'response') {
      const response = frame.response
      const waiting = pending.get(response.id)
      if (!waiting) return
      pending.delete(response.id)
      if (response.error !== undefined) {
        // A refusal from a bridge that could not be made, for want of a key or otherwise, is not
        // about the command that met it.
        const message =
          response.code === BRIDGE_UNAVAILABLE || isDatabaseKeyCode(response.code)
            ? response.error
            : `${waiting.command}: ${response.error}`
        waiting.reject(new SessionClientError(message, response.code))
      } else {
        waiting.resolve(response)
      }
      return
    }

    // The event the shim built, handed on as it is: the wire type and the app's are the same
    // declaration, so there is nothing here to translate.
    for (const listener of listeners) listener(frame.event)
  })

  function call(command: Command): Promise<Response> {
    if (closed) return Promise.reject(new BridgeClosedError())

    const id = nextRequestId++
    const request: Request = { id, command }

    return new Promise<Response>((resolve, reject) => {
      pending.set(id, { resolve, reject, command: command.type })
      transport.send(request)
    })
  }

  /** Every command returns a result; a Response without one is a shim bug, not a value. */
  function resultOf<K extends Result['type']>(response: Response, kind: K): ResultOf<K> {
    if (response.result?.type !== kind) {
      throw new SessionClientError(
        `Expected a ${kind} result but the bridge sent ${response.result?.type ?? 'nothing'}`,
      )
    }
    return response.result as ResultOf<K>
  }

  const client: SessionClient = {
    onEvent(listener) {
      listeners.add(listener)
      const unsubscribe: Unsubscribe = () => {
        listeners.delete(listener)
      }
      return unsubscribe
    },

    async getAccountInfo(): Promise<AccountInfo> {
      const response = await call({ type: 'getAccountInfo' })
      return resultOf(response, 'accountInfo').info
    },

    async createAccount(): Promise<void> {
      await call({ type: 'createAccount' })
    },

    async restoreAccount(from): Promise<void> {
      if ('hexSeed' in from) {
        await call({ type: 'restoreAccountFromSeed', hexSeed: from.hexSeed })
        return
      }
      await call({
        type: 'restoreAccountFromWords',
        phrase: phraseBytes(from.words),
        ...(from.language === undefined ? {} : { language: from.language }),
      })
    },

    async checkRecoveryPhrase(words, language): Promise<void> {
      await call({
        type: 'checkRecoveryPhrase',
        phrase: phraseBytes(words),
        ...(language === undefined ? {} : { language }),
      })
    },

    async discardAccount(): Promise<void> {
      await call({ type: 'discardAccount' })
    },

    async keepAccount(): Promise<void> {
      await call({ type: 'keepAccount' })
    },

    async getSeedMnemonic(language): Promise<string[] | null> {
      const response = await call({
        type: 'getSeedMnemonic',
        ...(language === undefined ? {} : { language }),
      })
      if (response.result?.type === 'seedHidden') return null
      return resultOf(response, 'mnemonic').words
    },

    async getSeedHex(): Promise<string | null> {
      const response = await call({ type: 'getSeedHex' })
      if (response.result?.type === 'seedHidden') return null
      return resultOf(response, 'hex').hex
    },

    async hideRecoveryPassword(): Promise<void> {
      await call({ type: 'hideRecoveryPassword' })
    },

    async getRecoveryPasswordHidden(): Promise<boolean> {
      return resultOf(await call({ type: 'getRecoveryPasswordHidden' }), 'bool').value
    },

    async setDisplayName(name): Promise<void> {
      await call({ type: 'setDisplayName', name })
    },

    async attachNetwork(config): Promise<void> {
      await call({
        type: 'attachNetwork',
        netid: config.netid,
        ...(config.seedNodes === undefined ? {} : { seedNodes: config.seedNodes }),
        ...(config.fileServer === undefined ? {} : { fileServer: config.fileServer }),
        ...(config.router === undefined ? {} : { router: config.router }),
      })
    },

    async pollOnce(): Promise<void> {
      await call({ type: 'pollOnce' })
    },

    async warmNetworkCache(): Promise<boolean> {
      const response = await call({ type: 'warmNetworkCache' })
      return resultOf(response, 'bool').value
    },

    async getConversations(): Promise<Conversation[]> {
      const response = await call({ type: 'getConversations' })
      return resultOf(response, 'conversationList').conversations
    },

    async getMessageRequests(): Promise<Conversation[]> {
      const response = await call({ type: 'getMessageRequests' })
      return resultOf(response, 'conversationList').conversations
    },

    async getConversation(id): Promise<Conversation> {
      const response = await call({ type: 'getConversation', conversationId: id })
      return resultOf(response, 'conversation').conversation
    },

    async openDm(sessionId): Promise<ConversationId> {
      const response = await call({ type: 'openDm', sessionId })
      return resultOf(response, 'conversation').conversation.id
    },

    async markRead(id, upTo): Promise<void> {
      await call({
        type: 'markRead',
        conversationId: id,
        ...(upTo === undefined ? {} : { upTo }),
      })
    },

    async setPollInterval(intervalMs): Promise<void> {
      await call({ type: 'setPollInterval', intervalMs })
    },
    async closeClient(waitMs, interruptMs): Promise<ClientClosed> {
      const { type: _type, ...closed } = resultOf(
        await call({ type: 'closeClient', waitMs, interruptMs }),
        'clientClosed',
      )
      return closed
    },
    async reopenClient(): Promise<void> {
      await call({ type: 'reopenClient' })
    },
    async setReceiving(on): Promise<void> {
      await call({ type: 'setReceiving', on })
    },
    async setPushToken(service, token, force): Promise<boolean> {
      const command = { type: 'setPushToken' as const, service, token }
      return resultOf(await call(force === true ? { ...command, force } : command), 'bool').value
    },
    async clearPushToken(): Promise<void> {
      await call({ type: 'clearPushToken' })
    },
    async getNotificationContent(): Promise<NotificationContent> {
      return resultOf(await call({ type: 'getNotificationContent' }), 'notificationContent').content
    },
    async setNotificationContent(content): Promise<void> {
      await call({ type: 'setNotificationContent', content })
    },
    async getNotificationSound(): Promise<NotificationSound> {
      return resultOf(await call({ type: 'getNotificationSound' }), 'notificationSound').sound
    },
    async setNotificationSound(sound): Promise<void> {
      await call({ type: 'setNotificationSound', sound })
    },
    async setNotificationYou(you): Promise<void> {
      await call({ type: 'setNotificationYou', you })
    },
    async setBlocked(id, blocked): Promise<void> {
      await call({ type: 'setBlocked', conversationId: id, blocked })
    },

    async setNickname(id, nickname): Promise<void> {
      await call({
        type: 'setNickname',
        conversationId: id,
        ...(nickname === undefined ? {} : { nickname }),
      })
    },

    async setPriority(id, priority): Promise<void> {
      await call({ type: 'setPriority', conversationId: id, priority })
    },

    async approveConversation(id): Promise<void> {
      await call({ type: 'approveConversation', conversationId: id })
    },

    async deleteConversation(id, keepMessages = false): Promise<void> {
      await call({ type: 'deleteConversation', conversationId: id, keepMessages })
    },

    async getMessages(id, options): Promise<MessagePage> {
      const { before, after, around } = options ?? {}
      const response = await call({
        type: 'getMessages',
        conversationId: id,
        limit: options?.limit ?? 50,
        includeDeleted: options?.includeDeleted ?? false,
        ...(before === undefined ? {} : { before }),
        ...(after === undefined ? {} : { after }),
        ...(around === undefined ? {} : { around }),
      })
      const { messages, hasNewer, hasOlder } = resultOf(response, 'messagePage')
      return { messages, hasNewer, hasOlder }
    },

    async sendMessage(id, message: OutgoingMessage): Promise<number> {
      const response = await call({
        type: 'sendMessage',
        conversationId: id,
        body: message.body,
        ...(message.replyTo === undefined ? {} : { replyTo: message.replyTo }),
        ...(message.attachments === undefined || message.attachments.length === 0
          ? {}
          : { attachments: message.attachments }),
      })
      return resultOf(response, 'messageId').messageId
    },

    async retrySend(messageId): Promise<boolean> {
      const response = await call({ type: 'retrySend', messageId })
      return resultOf(response, 'bool').value
    },

    async setGallery(messageId, gallery): Promise<boolean> {
      const response = await call({ type: 'setGallery', messageId, gallery })
      return resultOf(response, 'bool').value
    },

    async deleteMessage(messageId, scope: Deletion): Promise<void> {
      await call({ type: 'deleteMessage', messageId, scope })
    },

    async downloadAttachment(messageId, index): Promise<void> {
      await call({ type: 'downloadAttachment', messageId, index })
    },

    async exportAttachment(messageId, index, destination, options): Promise<string> {
      const response = await call({
        type: 'exportAttachment',
        messageId,
        index,
        destination,
        notifySender: options?.notifySender ?? true,
        replace: options?.replace ?? false,
      })
      return resultOf(response, 'path').path
    },

    async attachmentSendPlan(path, contentType): Promise<SendPlan> {
      const response = await call({
        type: 'attachmentSendPlan',
        path,
        ...(contentType === undefined ? {} : { contentType }),
      })
      return resultOf(response, 'sendPlan').plan
    },

    async setAutoDownload(id, mode: AutoDownload): Promise<void> {
      await call({ type: 'setAutoDownload', conversationId: id, mode })
    },

    async getNetworkStatus(): Promise<NetworkStatus> {
      const response = await call({ type: 'getNetworkStatus' })
      return resultOf(response, 'networkStatus').status
    },

    async getCacheDir(): Promise<string> {
      const response = await call({ type: 'getCacheDir' })
      return resultOf(response, 'path').path
    },

    async getAttachmentUploadLimit(): Promise<number> {
      const response = await call({ type: 'getAttachmentUploadLimit' })
      const { bytes } = resultOf(response, 'byteCount')
      if (bytes === undefined)
        throw new SessionClientError('getAttachmentUploadLimit answered no limit')
      return bytes
    },

    async getAttachmentCacheLimit(): Promise<number | undefined> {
      const response = await call({ type: 'getAttachmentCacheLimit' })
      return resultOf(response, 'byteCount').bytes
    },

    async setAttachmentCacheLimit(limitBytes): Promise<void> {
      await call({
        type: 'setAttachmentCacheLimit',
        ...(limitBytes === undefined ? {} : { limitBytes }),
      })
    },

    async getAttachmentCacheSize(): Promise<number> {
      const response = await call({ type: 'getAttachmentCacheSize' })
      return resultOf(response, 'byteCount').bytes ?? 0
    },

    async getThumbnailEdge(): Promise<number> {
      const response = await call({ type: 'getThumbnailEdge' })
      return resultOf(response, 'edge').edgePx
    },

    async setThumbnailEdge(edgePx): Promise<void> {
      await call({ type: 'setThumbnailEdge', ...(edgePx === undefined ? {} : { edgePx }) })
    },

    async getNetworkPaths(): Promise<NetworkPaths> {
      const response = await call({ type: 'getNetworkPaths' })
      return resultOf(response, 'networkPaths').snapshot
    },

    async getConfigSizes(): Promise<ConfigSize[]> {
      const response = await call({ type: 'getConfigSizes' })
      return resultOf(response, 'configSizes').sizes
    },

    async getPref(key): Promise<string | undefined> {
      const response = await call({ type: 'getPref', key })
      return resultOf(response, 'pref').value
    },

    async setPref(key, value): Promise<void> {
      await call({ type: 'setPref', key, value })
    },

    close(): void {
      if (closed) return
      closed = true
      const waiting = [...pending.values()]
      pending.clear()
      listeners.clear()
      for (const request of waiting) request.reject(new BridgeClosedError())
      transport.close()
    },
  }

  return client
}
