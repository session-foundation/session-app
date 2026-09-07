import type { HybridObject } from 'react-native-nitro-modules'

/**
 * What a JSI property access costs, measured on the types that actually cross.
 *
 * The report's case for handing structs over instead of protobuf bytes rests on a number nobody
 * has taken: the parse is 96% of the per-row cost under Hermes and disappears with the wire, but
 * whatever replaces it is not free either, and it is paid per field rather than per row. Fifteen
 * fields on a Conversation, a 66-character account id among them, two enums that the app wants as
 * strings, and three optionals that have to express absence - all of it work the C++ does not do
 * today.
 *
 * Two shapes, because the choice between them is the decision:
 *
 * - A **struct** is marshalled into a real JavaScript object as it crosses, so every row is built
 *   whether or not anything reads it. Cheap per read afterwards; pays for all five thousand.
 * - A **HybridObject** is a view. Constructing it is nearly free and each property read crosses
 *   into C++, so the bill follows what the UI actually touches - twelve rows on screen, four
 *   fields each - and rows nobody scrolls to cost nothing.
 *
 * The field values match `tests/bench/src/fixtures.ts` exactly - same lengths, same optionals left
 * absent, same two words of display name and eight of snippet - so these numbers can be put
 * beside the 29.67 µs/row parse and 1.33 µs/row convert without an asterisk.
 */

/**
 * Named aliases, because nitrogen only generates an enum from one it can name - an inline union
 * in a field position is refused, which is the same constraint `SessionBridgeOptions` ran into.
 */
export type BenchConversationKind = 'dm' | 'group' | 'community'
export type BenchAutoDownload = 'none' | 'image-attachments' | 'all'
export type BenchSendState =
  'pending' | 'sending' | 'sent' | 'failed' | 'interrupted' | 'uploading' | 'unsendable'

/** Mirrors `Conversation` in `@session/client`, including the enums as string unions. */
export interface BenchConversation {
  id: string
  kind: BenchConversationKind
  displayName: string
  nickname?: string
  lastActivity: number
  priority: number
  unreadCount: number
  markedUnread: boolean
  snippet?: string
  muteUntil?: number
  autoDownload: BenchAutoDownload
  request: boolean
  awaitingApproval: boolean
  noteToSelf: boolean
  blocked: boolean
}

/** Mirrors `Message`, minus `attachments` - the fixtures send none, so neither does this. */
export interface BenchMessage {
  id: number
  conversationId: string
  author: string
  timestamp: number
  body: string
  outgoing: boolean
  sendState: BenchSendState
}

/** The same fifteen fields, read one JSI hop at a time. */
export interface BenchConversationHandle extends HybridObject<{ ios: 'c++'; android: 'c++' }> {
  readonly id: string
  readonly kind: BenchConversationKind
  readonly displayName: string
  readonly nickname?: string
  readonly lastActivity: number
  readonly priority: number
  readonly unreadCount: number
  readonly markedUnread: boolean
  readonly snippet?: string
  readonly muteUntil?: number
  readonly autoDownload: BenchAutoDownload
  readonly request: boolean
  readonly awaitingApproval: boolean
  readonly noteToSelf: boolean
  readonly blocked: boolean
}

export interface BenchMessageHandle extends HybridObject<{ ios: 'c++'; android: 'c++' }> {
  readonly id: number
  readonly conversationId: string
  readonly author: string
  readonly timestamp: number
  readonly body: string
  readonly outgoing: boolean
  readonly sendState: BenchSendState
}

export interface BenchStructs extends HybridObject<{ ios: 'c++'; android: 'c++' }> {
  /** Eager: `count` rows marshalled into JavaScript objects before this returns. */
  makeConversationStructs(count: number): BenchConversation[]
  makeMessageStructs(count: number): BenchMessage[]

  /** Lazy: `count` views, each field still on the C++ side until something asks. */
  makeConversationHandles(count: number): BenchConversationHandle[]
  makeMessageHandles(count: number): BenchMessageHandle[]

  /**
   * Generates the corpus and returns only how many rows it made.
   *
   * The first run of this benchmark built the corpus inside every call and reported the total,
   * which measured C++ string generation and JSI marshalling added together and could not
   * separate them - and the two readings that fit that number differ by a factor of five, which
   * is the whole decision. Subtract this from the struct and handle calls to get the marshalling
   * on its own.
   */
  generateOnly(count: number): number

  /**
   * A no-argument, no-return call, to price the crossing on its own.
   *
   * Every number above is a crossing plus some work; without this there is no way to tell which
   * of the two a result is measuring.
   */
  nothing(): void
}
