import { create, fromBinary, toBinary, type MessageInitShape } from '@bufbuild/protobuf'
import {
  FrameSchema,
  RequestSchema,
  type AttachmentProgress as AttachmentProgressPb,
  type Event as EventPb,
  type Response,
} from '@session/proto'

import {
  deletionToPb,
  fromConversationPb,
  fromMessagePb,
  toBigInt,
  toOutgoingAttachmentPb,
} from './convert'
import { BridgeClosedError, SessionClientError } from './errors'
import type {
  AccountInfo,
  AttachmentProgress,
  BridgeTransport,
  Conversation,
  ConversationId,
  Deletion,
  Message,
  MessageCursor,
  OutgoingMessage,
  ProgressCallback,
  SessionClient,
  SessionEvent,
  Unsubscribe,
} from './types'

type Pending = {
  resolve: (response: Response) => void
  reject: (error: Error) => void
}

/** The names of the result variants a Response can carry, and what each one holds. */
type ResultCase = NonNullable<Response['result']['case']>
type ResultValue<T extends ResultCase> = Extract<Response['result'], { case: T }>['value']

/** A command's own progress reports, routed back to whoever issued it. */
type ProgressRegistration = {
  callback: ProgressCallback
  /** Indexes that have reported a result; the registration retires when all have. */
  settled: Set<number>
  seen: Set<number>
}

function progressFromPb(pb: AttachmentProgressPb): AttachmentProgress {
  return {
    messageId: Number(pb.messageId),
    index: pb.index,
    done: Number(pb.done),
    total: Number(pb.total),
    ...(pb.result === undefined ? {} : { result: pb.result }),
  }
}

function decodeEvent(pb: EventPb): SessionEvent | null {
  switch (pb.kind.case) {
    case 'conversationAdded':
      return pb.kind.value.conversation
        ? {
            type: 'conversation-added',
            conversation: fromConversationPb(pb.kind.value.conversation),
          }
        : null
    case 'conversationUpdated':
      return pb.kind.value.conversation
        ? {
            type: 'conversation-updated',
            conversation: fromConversationPb(pb.kind.value.conversation),
          }
        : null
    case 'conversationRemoved':
      return { type: 'conversation-removed', conversationId: pb.kind.value.conversationId }
    case 'conversationListReplaced':
      return {
        type: 'conversation-list-replaced',
        conversations: pb.kind.value.conversations.map(fromConversationPb),
      }
    case 'requestListReplaced':
      return {
        type: 'request-list-replaced',
        conversations: pb.kind.value.conversations.map(fromConversationPb),
      }
    case 'messageAdded':
      return pb.kind.value.message
        ? {
            type: 'message-added',
            conversationId: pb.kind.value.conversationId,
            message: fromMessagePb(pb.kind.value.message, pb.kind.value.conversationId),
          }
        : null
    case 'messageUpdated':
      return pb.kind.value.message
        ? {
            type: 'message-updated',
            conversationId: pb.kind.value.conversationId,
            message: fromMessagePb(pb.kind.value.message, pb.kind.value.conversationId),
          }
        : null
    case 'historyReplaced':
      return { type: 'history-replaced', conversationId: pb.kind.value.conversationId }
    case 'attachmentProgress':
      return {
        type: 'attachment-progress',
        ...(pb.kind.value.conversationId === undefined
          ? {}
          : { conversationId: pb.kind.value.conversationId }),
        progress: progressFromPb(pb.kind.value),
      }
    case 'displayPictureProgress':
      return {
        type: 'display-picture-progress',
        conversationId: pb.kind.value.conversationId,
        done: Number(pb.kind.value.done),
        total: Number(pb.kind.value.total),
        ...(pb.kind.value.result === undefined ? {} : { result: pb.kind.value.result }),
      }
    case 'log':
      return {
        type: 'log',
        message: pb.kind.value.message,
        category: pb.kind.value.category,
        level: pb.kind.value.level,
      }
    default:
      return null
  }
}

/**
 * Turns a transport into the client everything else is written against.
 *
 * Requests are submitted and forgotten; their answers come back on the same ordered stream
 * as the change events, tagged with the request id. That is what preserves libsession's
 * ordering across the boundary - see frames.proto for why it is not two channels.
 */
export function createSessionClient(transport: BridgeTransport): SessionClient {
  let nextRequestId = 1
  let closed = false
  const pending = new Map<number, Pending>()
  const progress = new Map<number, ProgressRegistration>()
  const listeners = new Set<(event: SessionEvent) => void>()

  transport.setSink((bytes) => {
    const frame = fromBinary(FrameSchema, bytes)

    if (frame.kind.case === 'response') {
      const response = frame.kind.value
      const waiting = pending.get(response.requestId)
      if (!waiting) return
      pending.delete(response.requestId)
      if (response.error !== undefined) {
        progress.delete(response.requestId)
        waiting.reject(new SessionClientError(response.error))
      } else {
        waiting.resolve(response)
      }
      return
    }

    if (frame.kind.case !== 'event') return
    const eventPb = frame.kind.value

    // A transfer a command asked for goes to that command's callback; one libsession
    // started on its own is broadcast as an event instead.
    if (eventPb.kind.case === 'attachmentProgress' && eventPb.kind.value.requestId !== undefined) {
      const requestId = eventPb.kind.value.requestId
      const registration = progress.get(requestId)
      if (registration) {
        const report = progressFromPb(eventPb.kind.value)
        registration.seen.add(report.index)
        registration.callback(report)
        if (report.result !== undefined) {
          registration.settled.add(report.index)
          // Exactly one report per index carries a result, so once every index we have
          // seen has settled there is nothing further to route.
          if (registration.settled.size === registration.seen.size) {
            progress.delete(requestId)
          }
        }
      }
      return
    }

    const event = decodeEvent(eventPb)
    if (!event) return
    for (const listener of listeners) listener(event)
  })

  type Command = NonNullable<MessageInitShape<typeof RequestSchema>['cmd']>

  function call(cmd: Command, onProgress?: ProgressCallback): Promise<Response> {
    if (closed) return Promise.reject(new BridgeClosedError())

    const id = nextRequestId++
    const request = create(RequestSchema, { id, cmd })

    return new Promise<Response>((resolve, reject) => {
      pending.set(id, { resolve, reject })
      if (onProgress) {
        progress.set(id, { callback: onProgress, settled: new Set(), seen: new Set() })
      }
      transport.send(toBinary(RequestSchema, request))
    })
  }

  /** Every command returns a result; a Response without one is a shim bug, not a value. */
  function expect<T extends ResultCase>(response: Response, kind: T): ResultValue<T> {
    if (response.result.case !== kind) {
      throw new SessionClientError(
        `Expected a ${kind} result but the bridge sent ${String(response.result.case)}`,
      )
    }
    return response.result.value as ResultValue<T>
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
      const response = await call({ case: 'getAccountInfo', value: {} })
      const info = expect(response, 'accountInfo')
      return {
        haveAccount: info.haveAccount,
        ...(info.sessionId === undefined ? {} : { sessionId: info.sessionId }),
        ...(info.displayName === undefined ? {} : { displayName: info.displayName }),
        networkAttached: info.networkAttached,
      }
    },

    async createAccount(): Promise<void> {
      await call({ case: 'createAccount', value: {} })
    },

    async restoreAccount(from): Promise<void> {
      const value =
        'hexSeed' in from
          ? ({ from: { case: 'hexSeed' as const, value: from.hexSeed } } as const)
          : ({
              from: {
                case: 'words' as const,
                value: {
                  words: from.words,
                  ...(from.language === undefined ? {} : { language: from.language }),
                },
              },
            } as const)
      await call({ case: 'restoreAccount', value })
    },

    async getSeedMnemonic(language): Promise<string[]> {
      const response = await call({
        case: 'getSeedMnemonic',
        value: language === undefined ? {} : { language },
      })
      return expect(response, 'mnemonic').words
    },

    async setDisplayName(name): Promise<void> {
      await call({ case: 'setDisplayName', value: { name } })
    },

    async attachNetwork(netid, devnetSeedUrl): Promise<void> {
      await call({
        case: 'attachNetwork',
        value: { netid, ...(devnetSeedUrl === undefined ? {} : { devnetSeedUrl }) },
      })
    },

    async pollOnce(): Promise<void> {
      await call({ case: 'pollOnce', value: {} })
    },

    async getConversations(): Promise<Conversation[]> {
      const response = await call({ case: 'getConversations', value: {} })
      return expect(response, 'conversationList').conversations.map(fromConversationPb)
    },

    async getMessageRequests(): Promise<Conversation[]> {
      const response = await call({ case: 'getMessageRequests', value: {} })
      return expect(response, 'conversationList').conversations.map(fromConversationPb)
    },

    async getConversation(id): Promise<Conversation> {
      const response = await call({ case: 'getConversation', value: { conversationId: id } })
      const result = expect(response, 'conversation').conversation
      if (!result) throw new SessionClientError('The bridge sent a conversation with no body')
      return fromConversationPb(result)
    },

    async openDm(sessionId): Promise<ConversationId> {
      const response = await call({ case: 'openDm', value: { sessionId } })
      return expect(response, 'conversation').conversation?.id ?? sessionId
    },

    async markRead(id, upTo): Promise<void> {
      await call({
        case: 'markRead',
        value: { conversationId: id, ...(upTo === undefined ? {} : { upTo: toBigInt(upTo) }) },
      })
    },

    async setBlocked(id, blocked): Promise<void> {
      await call({ case: 'setBlocked', value: { conversationId: id, blocked } })
    },

    async setNickname(id, nickname): Promise<void> {
      await call({
        case: 'setNickname',
        value: { conversationId: id, ...(nickname === undefined ? {} : { nickname }) },
      })
    },

    async setPriority(id, priority): Promise<void> {
      await call({ case: 'setPriority', value: { conversationId: id, priority } })
    },

    async approveConversation(id): Promise<void> {
      await call({ case: 'approveConversation', value: { conversationId: id } })
    },

    async deleteConversation(id, keepMessages = false): Promise<void> {
      await call({ case: 'deleteConversation', value: { conversationId: id, keepMessages } })
    },

    async getMessages(id, options): Promise<Message[]> {
      const before: MessageCursor | undefined = options?.before
      const response = await call({
        case: 'getMessages',
        value: {
          conversationId: id,
          limit: options?.limit ?? 50,
          includeDeleted: options?.includeDeleted ?? false,
          ...(before === undefined
            ? {}
            : { before: { timestamp: toBigInt(before.timestamp), id: toBigInt(before.id) } }),
        },
      })
      // The id the caller asked for: a page of messages answers a request that named one.
      return expect(response, 'messageList').messages.map((m) => fromMessagePb(m, id))
    },

    async sendMessage(id, message: OutgoingMessage, options): Promise<number> {
      const response = await call(
        {
          case: 'sendMessage',
          value: {
            conversationId: id,
            body: message.body,
            attachments: (message.attachments ?? []).map(toOutgoingAttachmentPb),
            ...(message.replyTo === undefined ? {} : { replyTo: toBigInt(message.replyTo) }),
          },
        },
        options?.onUploadProgress,
      )
      return Number(expect(response, 'messageId').messageId)
    },

    async retrySend(messageId, options): Promise<boolean> {
      const response = await call(
        { case: 'retrySend', value: { messageId: toBigInt(messageId) } },
        options?.onUploadProgress,
      )
      return expect(response, 'bool').value
    },

    async deleteMessage(messageId, scope: Deletion): Promise<void> {
      await call({
        case: 'deleteMessage',
        value: { messageId: toBigInt(messageId), scope: deletionToPb(scope) },
      })
    },

    async attachmentData(messageId, index, options): Promise<Uint8Array> {
      const response = await call(
        { case: 'attachmentData', value: { messageId: toBigInt(messageId), index } },
        options?.onProgress,
      )
      return expect(response, 'bytes').data
    },

    async saveAttachment(messageId, index, destination, options): Promise<string> {
      const response = await call(
        {
          case: 'saveAttachment',
          value: {
            messageId: toBigInt(messageId),
            index,
            destination,
            notifySender: options?.notifySender ?? false,
            replace: options?.replace ?? false,
          },
        },
        options?.onProgress,
      )
      return expect(response, 'path').path
    },

    async getPref(key): Promise<string | undefined> {
      const response = await call({ case: 'getPref', value: { key } })
      return expect(response, 'pref').value
    },

    async setPref(key, value): Promise<void> {
      await call({ case: 'setPref', value: { key, value } })
    },

    close(): void {
      if (closed) return
      closed = true
      const waiting = [...pending.values()]
      pending.clear()
      progress.clear()
      listeners.clear()
      for (const request of waiting) request.reject(new BridgeClosedError())
      transport.close()
    },
  }

  return client
}
