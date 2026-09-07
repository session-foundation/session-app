import { create, fromBinary, toBinary, type MessageInitShape } from '@bufbuild/protobuf'
import {
  AutoDownload as AutoDownloadPb,
  ConversationKind as ConversationKindPb,
  Deletion as DeletionPb,
  FrameSchema,
  RequestSchema,
  SendState as SendStatePb,
  type ConversationSchema,
  type EventSchema,
  type MessageSchema,
  type Request,
  type ResponseSchema,
} from '@session/proto'

import type { BridgeTransport, Conversation, Message, SessionClient, SessionEvent } from '../types'

type EventInit = MessageInitShape<typeof EventSchema>
type ConversationInit = MessageInitShape<typeof ConversationSchema>
type MessageInit = MessageInitShape<typeof MessageSchema>
type ResponseResult = NonNullable<MessageInitShape<typeof ResponseSchema>['result']>

/**
 * Speaks the bridge protocol on top of a plain SessionClient.
 *
 * Two things come out of this. The apps get to run against the fake through the same
 * codec, correlation and transport path they will use for the real thing, so the skeleton
 * exercises everything except the C++. And the shim has a reference implementation to match:
 * this file is the protocol written out in a language that is easy to read.
 */

const SEND_STATE: Record<Message['sendState'], SendStatePb> = {
  pending: SendStatePb.PENDING,
  sending: SendStatePb.SENDING,
  sent: SendStatePb.SENT,
  failed: SendStatePb.FAILED,
  interrupted: SendStatePb.INTERRUPTED,
  uploading: SendStatePb.UPLOADING,
  unsendable: SendStatePb.UNSENDABLE,
}

const KIND: Record<Conversation['kind'], ConversationKindPb> = {
  dm: ConversationKindPb.DM,
  group: ConversationKindPb.GROUP,
  community: ConversationKindPb.COMMUNITY,
}

const AUTO_DOWNLOAD: Record<Conversation['autoDownload'], AutoDownloadPb> = {
  none: AutoDownloadPb.NONE,
  'image-attachments': AutoDownloadPb.IMAGE_ATTACHMENTS,
  all: AutoDownloadPb.ALL,
}

function conversationToPb(c: Conversation): ConversationInit {
  return {
    id: c.id,
    kind: KIND[c.kind],
    displayName: c.displayName,
    ...(c.nickname === undefined ? {} : { nickname: c.nickname }),
    lastActivity: BigInt(c.lastActivity),
    priority: c.priority,
    unreadCount: c.unreadCount,
    markedUnread: c.markedUnread,
    ...(c.snippet === undefined ? {} : { snippet: c.snippet }),
    ...(c.muteUntil === undefined ? {} : { muteUntil: BigInt(c.muteUntil) }),
    autoDownload: AUTO_DOWNLOAD[c.autoDownload],
    request: c.request,
    awaitingApproval: c.awaitingApproval,
    noteToSelf: c.noteToSelf,
    blocked: c.blocked,
  }
}

/** The wire no longer carries conversation_id: every container already names the conversation. */
function messageToPb(m: Message): MessageInit {
  return {
    id: BigInt(m.id),
    author: m.author,
    timestamp: BigInt(m.timestamp),
    body: m.body,
    outgoing: m.outgoing,
    sendState: SEND_STATE[m.sendState],
    attachments: m.attachments.map((a) => ({
      index: a.index,
      ...(a.contentType === undefined ? {} : { contentType: a.contentType }),
      ...(a.filename === undefined ? {} : { filename: a.filename }),
      ...(a.caption === undefined ? {} : { caption: a.caption }),
      ...(a.size === undefined ? {} : { size: BigInt(a.size) }),
      voiceMessage: a.voiceMessage,
      ...(a.width === undefined ? {} : { width: a.width }),
      ...(a.height === undefined ? {} : { height: a.height }),
      uploaded: a.uploaded,
    })),
    ...(m.replyTo === undefined
      ? {}
      : {
          replyTo: {
            author: m.replyTo.author,
            timestamp: BigInt(m.replyTo.timestamp),
            ...(m.replyTo.messageId === undefined
              ? {}
              : { messageId: BigInt(m.replyTo.messageId) }),
            ...(m.replyTo.body === undefined ? {} : { body: m.replyTo.body }),
          },
        }),
    ...(m.deleted === undefined
      ? {}
      : { deleted: m.deleted === 'here' ? DeletionPb.HERE : DeletionPb.EVERYWHERE }),
  }
}

function eventInit(event: SessionEvent): EventInit {
  switch (event.type) {
    case 'conversation-added':
      return {
        kind: {
          case: 'conversationAdded' as const,
          value: { conversation: conversationToPb(event.conversation) },
        },
      }
    case 'conversation-updated':
      return {
        kind: {
          case: 'conversationUpdated' as const,
          value: { conversation: conversationToPb(event.conversation) },
        },
      }
    case 'conversation-removed':
      return {
        kind: {
          case: 'conversationRemoved' as const,
          value: { conversationId: event.conversationId },
        },
      }
    case 'conversation-list-replaced':
      return {
        kind: {
          case: 'conversationListReplaced' as const,
          value: { conversations: event.conversations.map(conversationToPb) },
        },
      }
    case 'request-list-replaced':
      return {
        kind: {
          case: 'requestListReplaced' as const,
          value: { conversations: event.conversations.map(conversationToPb) },
        },
      }
    case 'message-added':
      return {
        kind: {
          case: 'messageAdded' as const,
          value: {
            conversationId: event.conversationId,
            message: messageToPb(event.message),
          },
        },
      }
    case 'message-updated':
      return {
        kind: {
          case: 'messageUpdated' as const,
          value: {
            conversationId: event.conversationId,
            message: messageToPb(event.message),
          },
        },
      }
    case 'history-replaced':
      return {
        kind: {
          case: 'historyReplaced' as const,
          value: { conversationId: event.conversationId },
        },
      }
    default:
      return { kind: { case: undefined } }
  }
}

/**
 * Wraps a SessionClient as a transport.
 *
 * Handlers are dispatched one at a time and their answers are written to the same sink the
 * events go to, in the order they complete - the ordering guarantee the real shim gets from
 * running everything on Core's loop.
 */
export function createFakeTransport(client: SessionClient): BridgeTransport {
  let sink: ((frame: Uint8Array) => void) | null = null

  const unsubscribe = client.onEvent((event) => {
    const frame = create(FrameSchema, { kind: { case: 'event', value: eventInit(event) } })
    sink?.(toBinary(FrameSchema, frame))
  })

  function respond(requestId: number, result: ResponseResult, error?: string): void {
    const frame = create(FrameSchema, {
      kind: {
        case: 'response',
        value: {
          requestId,
          ...(error === undefined ? {} : { error }),
          ...(error === undefined ? { result } : {}),
        },
      },
    })
    sink?.(toBinary(FrameSchema, frame))
  }

  return {
    send(bytes: Uint8Array): void {
      const request = fromBinary(RequestSchema, bytes)
      void handle(client, request)
        .then((result) => respond(request.id, result))
        .catch((error: unknown) => {
          respond(request.id, { case: 'empty', value: {} }, describe(error))
        })
    },

    setSink(onFrame: (frame: Uint8Array) => void): void {
      sink = onFrame
    },

    close(): void {
      unsubscribe()
      sink = null
      client.close()
    },
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function handle(client: SessionClient, request: Request): Promise<ResponseResult> {
  const cmd = request.cmd

  switch (cmd.case) {
    case 'getAccountInfo': {
      const info = await client.getAccountInfo()
      return {
        case: 'accountInfo',
        value: {
          haveAccount: info.haveAccount,
          ...(info.sessionId === undefined ? {} : { sessionId: info.sessionId }),
          ...(info.displayName === undefined ? {} : { displayName: info.displayName }),
          networkAttached: info.networkAttached,
        },
      }
    }
    case 'getConversations': {
      const conversations = await client.getConversations()
      return {
        case: 'conversationList',
        value: { conversations: conversations.map(conversationToPb) },
      }
    }
    case 'getMessageRequests': {
      const conversations = await client.getMessageRequests()
      return {
        case: 'conversationList',
        value: { conversations: conversations.map(conversationToPb) },
      }
    }
    case 'getConversation': {
      const conversation = await client.getConversation(cmd.value.conversationId)
      return { case: 'conversation', value: { conversation: conversationToPb(conversation) } }
    }
    case 'getMessages': {
      const before = cmd.value.before
      const messages = await client.getMessages(cmd.value.conversationId, {
        limit: cmd.value.limit,
        ...(before === undefined
          ? {}
          : { before: { timestamp: Number(before.timestamp), id: Number(before.id) } }),
      })
      return { case: 'messageList', value: { messages: messages.map(messageToPb) } }
    }
    case 'sendMessage': {
      const id = await client.sendMessage(cmd.value.conversationId, {
        body: cmd.value.body,
        ...(cmd.value.replyTo === undefined ? {} : { replyTo: Number(cmd.value.replyTo) }),
      })
      return { case: 'messageId', value: { messageId: BigInt(id) } }
    }
    case 'markRead':
      await client.markRead(cmd.value.conversationId)
      return { case: 'empty', value: {} }
    case 'approveConversation':
      await client.approveConversation(cmd.value.conversationId)
      return { case: 'empty', value: {} }
    case 'openDm': {
      const id = await client.openDm(cmd.value.sessionId)
      const conversation = await client.getConversation(id)
      return { case: 'conversation', value: { conversation: conversationToPb(conversation) } }
    }
    case 'setBlocked':
      await client.setBlocked(cmd.value.conversationId, cmd.value.blocked)
      return { case: 'empty', value: {} }
    case 'deleteMessage':
      await client.deleteMessage(
        Number(cmd.value.messageId),
        cmd.value.scope === DeletionPb.EVERYWHERE ? 'everywhere' : 'here',
      )
      return { case: 'empty', value: {} }
    case 'pollOnce':
      await client.pollOnce()
      return { case: 'empty', value: {} }
    case 'getPref': {
      const value = await client.getPref(cmd.value.key)
      return { case: 'pref', value: value === undefined ? {} : { value } }
    }
    case 'setPref':
      await client.setPref(cmd.value.key, cmd.value.value)
      return { case: 'empty', value: {} }
    case 'getSeedMnemonic': {
      const words = await client.getSeedMnemonic()
      return { case: 'mnemonic', value: { words } }
    }
    case 'createAccount':
      await client.createAccount()
      return { case: 'empty', value: {} }
    case 'setDisplayName':
      await client.setDisplayName(cmd.value.name)
      return { case: 'empty', value: {} }
    case 'attachNetwork':
      await client.attachNetwork(cmd.value.netid)
      return { case: 'empty', value: {} }
    default:
      throw new Error(`The fake bridge does not implement ${String(cmd.case)} yet`)
  }
}
