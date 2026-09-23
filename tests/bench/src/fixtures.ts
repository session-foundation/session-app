import type { Conversation, Frame, Message } from '@session/client'

import { mulberry32, words } from './text'

/**
 * Payloads shaped like the ones that actually cross the bridge.
 *
 * Field sizes are what decide these numbers, so they are taken from the real thing rather than
 * rounded: an account ID is `05` plus 64 hex characters, and at 66 bytes it is most of what a
 * Message weighs. A fixture with short ids would understate every measurement here.
 *
 * The frames are the shim's own structs now rather than encoded protobuf, so a builder is an
 * object literal and there is no `Uint8Array` anywhere. What that removes from the numbers is
 * the point: the serialisation these benchmarks were built to size no longer happens.
 */

const HEX = '0123456789abcdef'

export function accountId(random: () => number): string {
  let id = '05'
  for (let i = 0; i < 64; i++) id += HEX[Math.floor(random() * 16)]
  return id
}

export interface Corpus {
  /** Distinct account ids, reused across the corpus the way real ones are. */
  accounts: string[]
  conversations: Conversation[]
  messages: Message[]
}

/**
 * `authorCount` is the lever that matters for the identity question: a DM has two authors and a
 * group has as many as it has members, so what repeating an account id costs is entirely a
 * function of this number against the message count.
 */
export function makeCorpus(options: {
  conversations: number
  messages: number
  authorCount?: number
  seed?: number
}): Corpus {
  const random = mulberry32(options.seed ?? 1)
  const authorCount = options.authorCount ?? 2

  const accounts: string[] = []
  for (let i = 0; i < Math.max(options.conversations, authorCount); i++) {
    accounts.push(accountId(random))
  }

  const now = 1_760_000_000_000

  const conversations: Conversation[] = []
  for (let i = 0; i < options.conversations; i++) {
    conversations.push({
      id: accounts[i] as string,
      kind: 'dm',
      displayName: words(random, 2),
      lastActivity: now - i * 60_000,
      priority: 0,
      unreadCount: i % 7,
      markedUnread: false,
      snippet: words(random, 8),
      request: false,
      awaitingApproval: false,
      noteToSelf: false,
      blocked: false,
    })
  }

  const conversationId = accounts[0] as string
  const messages: Message[] = []
  for (let i = 0; i < options.messages; i++) {
    messages.push({
      id: i + 1,
      conversationId,
      author: accounts[i % authorCount] as string,
      timestamp: now - (options.messages - i) * 30_000,
      // Real message bodies are mostly short with a long tail; a flat length would flatter
      // every number taken from them.
      body: words(random, 3 + Math.floor(random() * 30)),
      outgoing: i % 2 === 0,
      sendState: 'sent',
      // Text only: what the benchmark measures is the per-row cost of a transcript, and an
      // attachment on every row would measure a conversation nobody has.
      attachments: [],
      galleryViewable: false,
    })
  }

  return { accounts, conversations, messages }
}

export function conversationListFrame(conversations: Conversation[]): Frame {
  return { type: 'event', event: { type: 'conversation-list-replaced', conversations } }
}

export function messageAddedFrame(_conversationId: string, message: Message): Frame {
  // A batch of one: the message carries its own conversation, so the id is kept only to leave
  // every caller of this fixture reading the same as it did.
  return { type: 'event', event: { type: 'messages-added', messages: [message] } }
}

/** A single-conversation update - the event a poll produces when an unread count moves. */
export function conversationUpdatedFrame(conversation: Conversation): Frame {
  return { type: 'event', event: { type: 'conversation-updated', conversation } }
}

/** A Response frame the size a small command's answer really is. */
export function emptyResponseFrame(id: number): Frame {
  return { type: 'response', response: { id, result: { type: 'empty' } } }
}
