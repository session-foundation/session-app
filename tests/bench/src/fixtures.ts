import { create, toBinary } from '@bufbuild/protobuf'
import {
  ConversationKind,
  ConversationSchema,
  EventSchema,
  FrameSchema,
  MessageSchema,
  SendState,
  type Conversation as ConversationPb,
  type Message as MessagePb,
} from '@session/proto'

/**
 * Payloads shaped like the ones that actually cross the bridge.
 *
 * Field sizes are what decide these numbers, so they are taken from the real thing rather than
 * rounded: an account ID is `05` plus 64 hex characters, and at 66 bytes it is most of what a
 * Message weighs. A fixture with short ids would understate every decode measurement here.
 */

/** Deterministic, so two runs of the suite are comparable. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const HEX = '0123456789abcdef'

export function accountId(random: () => number): string {
  let id = '05'
  for (let i = 0; i < 64; i++) id += HEX[Math.floor(random() * 16)]
  return id
}

const WORDS =
  'the a of and to in is it you that he was for on are as with his they at be this from I have or by one had not but what all were we when your can said there use an each which she do how their if will up other about out many then them these so'.split(
    ' ',
  )

function words(random: () => number, count: number): string {
  const out: string[] = []
  for (let i = 0; i < count; i++) out.push(WORDS[Math.floor(random() * WORDS.length)] as string)
  return out.join(' ')
}

export interface Corpus {
  /** Distinct account ids, reused across the corpus the way real ones are. */
  accounts: string[]
  conversations: ConversationPb[]
  messages: MessagePb[]
}

/**
 * `authorCount` is the lever that matters for the interning question: a DM has two authors and a
 * group has as many as it has members, so the win from a string table is entirely a function of
 * this number against the message count.
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

  const conversations: ConversationPb[] = []
  for (let i = 0; i < options.conversations; i++) {
    conversations.push(
      create(ConversationSchema, {
        id: accounts[i] as string,
        kind: ConversationKind.DM,
        displayName: words(random, 2),
        lastActivity: BigInt(now - i * 60_000),
        priority: 0,
        unreadCount: i % 7,
        markedUnread: false,
        snippet: words(random, 8),
        autoDownload: 0,
        request: false,
        awaitingApproval: false,
        noteToSelf: false,
        blocked: false,
      }),
    )
  }

  const conversationId = accounts[0] as string
  const messages: MessagePb[] = []
  for (let i = 0; i < options.messages; i++) {
    messages.push(
      create(MessageSchema, {
        id: BigInt(i + 1),
        conversationId,
        author: accounts[i % authorCount] as string,
        timestamp: BigInt(now - (options.messages - i) * 30_000),
        // Real message bodies are mostly short with a long tail; a flat length would flatter
        // the decode numbers.
        body: words(random, 3 + Math.floor(random() * 30)),
        outgoing: i % 2 === 0,
        sendState: SendState.SENT,
        attachments: [],
      }),
    )
  }

  return { accounts, conversations, messages }
}

export function conversationListFrame(conversations: ConversationPb[]): Uint8Array {
  return toBinary(
    FrameSchema,
    create(FrameSchema, {
      kind: {
        case: 'event',
        value: create(EventSchema, {
          kind: { case: 'conversationListReplaced', value: { conversations } },
        }),
      },
    }),
  )
}

export function messageAddedFrame(conversationId: string, message: MessagePb): Uint8Array {
  return toBinary(
    FrameSchema,
    create(FrameSchema, {
      kind: {
        case: 'event',
        value: create(EventSchema, {
          kind: { case: 'messageAdded', value: { conversationId, message } },
        }),
      },
    }),
  )
}

/** A single-conversation update - the event a poll produces when an unread count moves. */
export function conversationUpdatedFrame(conversation: ConversationPb): Uint8Array {
  return toBinary(
    FrameSchema,
    create(FrameSchema, {
      kind: {
        case: 'event',
        value: create(EventSchema, {
          kind: { case: 'conversationUpdated', value: { conversation } },
        }),
      },
    }),
  )
}
