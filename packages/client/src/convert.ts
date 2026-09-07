/**
 * Where the wire types become the types the app uses.
 *
 * Two jobs: turn protobuf's bigints into numbers, and turn its numeric enums into the
 * string unions that read well in a switch. Both directions live here so that a schema
 * change breaks in one file rather than in every screen.
 */

import {
  AutoDownload as AutoDownloadPb,
  ConversationKind as ConversationKindPb,
  Deletion as DeletionPb,
  SendState as SendStatePb,
  type Attachment as AttachmentPb,
  type Conversation as ConversationPb,
  type Message as MessagePb,
  type OutgoingAttachment as OutgoingAttachmentPb,
} from '@session/proto'

import type {
  Attachment,
  AutoDownload,
  Conversation,
  ConversationKind,
  Deletion,
  Message,
  OutgoingAttachment,
  SendState,
} from './types'

/**
 * Every int64 on this bridge is a unix-millisecond timestamp, a sqlite rowid or a byte
 * count. 2^53 milliseconds is the year 287396 and rowids do not get there either, so the
 * conversion is lossless in practice - and it keeps bigint out of every comparison in the
 * store and the UI.
 */
function toNumber(value: bigint): number {
  return Number(value)
}

export function toBigInt(value: number): bigint {
  return BigInt(Math.trunc(value))
}

const SEND_STATE: Record<SendStatePb, SendState> = {
  [SendStatePb.PENDING]: 'pending',
  [SendStatePb.SENDING]: 'sending',
  [SendStatePb.SENT]: 'sent',
  [SendStatePb.FAILED]: 'failed',
  [SendStatePb.INTERRUPTED]: 'interrupted',
  [SendStatePb.UPLOADING]: 'uploading',
  [SendStatePb.UNSENDABLE]: 'unsendable',
}

const CONVERSATION_KIND: Record<ConversationKindPb, ConversationKind> = {
  [ConversationKindPb.UNSPECIFIED]: 'dm',
  [ConversationKindPb.DM]: 'dm',
  [ConversationKindPb.GROUP]: 'group',
  [ConversationKindPb.COMMUNITY]: 'community',
}

const AUTO_DOWNLOAD: Record<AutoDownloadPb, AutoDownload> = {
  [AutoDownloadPb.NONE]: 'none',
  [AutoDownloadPb.IMAGE_ATTACHMENTS]: 'image-attachments',
  [AutoDownloadPb.ALL]: 'all',
}

export function deletionToPb(scope: Deletion): DeletionPb {
  return scope === 'here' ? DeletionPb.HERE : DeletionPb.EVERYWHERE
}

function fromDeletionPb(scope: DeletionPb): Deletion | undefined {
  switch (scope) {
    case DeletionPb.HERE:
      return 'here'
    case DeletionPb.EVERYWHERE:
      return 'everywhere'
    default:
      return undefined
  }
}

function fromAttachmentPb(pb: AttachmentPb): Attachment {
  return {
    index: pb.index,
    ...(pb.contentType === undefined ? {} : { contentType: pb.contentType }),
    ...(pb.filename === undefined ? {} : { filename: pb.filename }),
    ...(pb.caption === undefined ? {} : { caption: pb.caption }),
    ...(pb.size === undefined ? {} : { size: toNumber(pb.size) }),
    voiceMessage: pb.voiceMessage,
    ...(pb.width === undefined ? {} : { width: pb.width }),
    ...(pb.height === undefined ? {} : { height: pb.height }),
    uploaded: pb.uploaded,
  }
}

/**
 * `conversationId` is supplied rather than read off the message, because the wire no longer carries
 * it: every container already establishes which conversation it is - an event names it beside the
 * message, and a page answers a request that named one - so repeating it per row was 29% of a page
 * spent on something the reader already knew. The facade type keeps the field, since a message
 * knowing its conversation is worth having; only the bytes lost it.
 */
export function fromMessagePb(pb: MessagePb, conversationId: string): Message {
  const deleted = fromDeletionPb(pb.deleted ?? DeletionPb.UNSPECIFIED)
  return {
    id: toNumber(pb.id),
    conversationId,
    author: pb.author,
    timestamp: toNumber(pb.timestamp),
    body: pb.body,
    outgoing: pb.outgoing,
    sendState: SEND_STATE[pb.sendState] ?? 'pending',
    attachments: pb.attachments.map(fromAttachmentPb),
    ...(pb.replyTo === undefined
      ? {}
      : {
          replyTo: {
            author: pb.replyTo.author,
            timestamp: toNumber(pb.replyTo.timestamp),
            ...(pb.replyTo.messageId === undefined
              ? {}
              : { messageId: toNumber(pb.replyTo.messageId) }),
            ...(pb.replyTo.body === undefined ? {} : { body: pb.replyTo.body }),
          },
        }),
    ...(deleted === undefined ? {} : { deleted }),
  }
}

export function fromConversationPb(pb: ConversationPb): Conversation {
  return {
    id: pb.id,
    kind: CONVERSATION_KIND[pb.kind] ?? 'dm',
    displayName: pb.displayName,
    ...(pb.nickname === undefined ? {} : { nickname: pb.nickname }),
    lastActivity: toNumber(pb.lastActivity),
    priority: pb.priority,
    unreadCount: pb.unreadCount,
    markedUnread: pb.markedUnread,
    ...(pb.snippet === undefined ? {} : { snippet: pb.snippet }),
    ...(pb.muteUntil === undefined ? {} : { muteUntil: toNumber(pb.muteUntil) }),
    autoDownload: AUTO_DOWNLOAD[pb.autoDownload] ?? 'none',
    request: pb.request,
    awaitingApproval: pb.awaitingApproval,
    noteToSelf: pb.noteToSelf,
    blocked: pb.blocked,
  }
}

export function toOutgoingAttachmentPb(
  attachment: OutgoingAttachment,
): Omit<OutgoingAttachmentPb, '$typeName' | '$unknown'> {
  return {
    path: attachment.path,
    ...(attachment.contentType === undefined ? {} : { contentType: attachment.contentType }),
    ...(attachment.filename === undefined ? {} : { filename: attachment.filename }),
    ...(attachment.caption === undefined ? {} : { caption: attachment.caption }),
    voiceMessage: attachment.voiceMessage ?? false,
    ...(attachment.width === undefined ? {} : { width: attachment.width }),
    ...(attachment.height === undefined ? {} : { height: attachment.height }),
  }
}
