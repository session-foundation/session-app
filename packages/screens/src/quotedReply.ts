import type { MediaPort } from '@session/app'
import type { Attachment, Conversation, Message, Reply } from '@session/client'
import { isolate, tr } from '@session/localization'
import type { QuoteLabels, QuotedMessage } from '@session/ui'

import { conversationTitle } from './conversationTitle'

/** A quote's kind labels and its not-found line, in the language of the moment it is called. */
export function quoteLabels(): QuoteLabels {
  return {
    image: tr('image'),
    gif: tr('gif'),
    video: tr('video'),
    audio: tr('audio'),
    voice: tr('messageVoice'),
    file: tr('document'),
    andMore: (count) => tr('andMore', { count }),
    notFound: tr('messageErrorOriginal'),
  }
}

/** As much of a conversation as naming a message's author in it needs. */
type AuthorsConversation = Pick<Conversation, 'id'> &
  Partial<Pick<Conversation, 'nickname' | 'displayName'>>

/**
 * What to call whoever wrote a message: "You" for this account, so always in a note to self;
 * the conversation's name for the other side of a DM; otherwise the shortened account id.
 */
export function authorName(
  author: string,
  ownId: string | undefined,
  conversation: AuthorsConversation,
): string {
  if (author === ownId) return tr('you')
  return conversationTitle(author === conversation.id ? conversation : { id: author })
}

/** The composer bar's heading: "Replying to" and the author, isolated from the words around it. */
export function replyingToHeading(author: string): string {
  return `${tr('messageReplyingTo')} ${isolate(author)}`
}

type QuoteMedia = Pick<MediaPort, 'thumbnailUrlFor' | 'thumbhashUrlFor'>

function quotedAttachment(
  messageId: number,
  attachment: Attachment,
  media: QuoteMedia,
): QuotedMessage['attachments'][number] {
  const ref = { messageId, index: attachment.index }
  return {
    contentType: attachment.contentType,
    filename: attachment.filename,
    voiceMessage: attachment.voiceMessage,
    uri: attachment.hasThumbnail ? media.thumbnailUrlFor(ref) : undefined,
    thumbhash: attachment.hasThumbhash ? media.thumbhashUrlFor(ref) : undefined,
    unavailable: attachment.availability === 'notFound' || attachment.availability === 'unreadable',
  }
}

/** A stored message as a quote of it draws one. */
export function quotedMessage(
  message: Pick<Message, 'id' | 'outgoing' | 'body' | 'attachments' | 'deleted'>,
  media: QuoteMedia,
): QuotedMessage {
  return {
    id: message.id,
    outgoing: message.outgoing,
    body: message.body,
    attachments: message.attachments.map((a) => quotedAttachment(message.id, a, media)),
    deleted: message.deleted !== undefined,
  }
}

/** The message a reply answers as its quote draws it; undefined where this device lacks it. */
export function quotedOriginal(reply: Reply, media: QuoteMedia): QuotedMessage | undefined {
  return reply.message === undefined ? undefined : quotedMessage(reply.message, media)
}

/** Whether a reply's original is here to jump to: neither missing nor deleted. */
export function originalFound(reply: Reply): reply is Reply & { messageId: number } {
  return reply.messageId !== undefined && reply.message?.deleted === undefined
}

/**
 * Whether a message can be answered: not a deleted one, and of ours only one that was sent, since
 * a reply names a message the other side has to hold.
 */
export function canReply(message: Message): boolean {
  if (message.deleted !== undefined) return false
  return !message.outgoing || message.sendState === 'sent'
}
