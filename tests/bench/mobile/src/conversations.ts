/**
 * Rows to render. Deliberately not the protobuf fixtures: the render benchmark measures React,
 * and building the corpus through a decode would put the thing the other benchmark measures
 * inside this one.
 */

import { mulberry32, words } from '../../src/text'

export interface Conversation {
  id: string
  displayName: string
  snippet: string
  unreadCount: number
}

export function makeConversations(count: number, seed = 3): Conversation[] {
  const random = mulberry32(seed)

  return Array.from({ length: count }, (_, i) => ({
    id: `c${String(i)}`,
    displayName: words(random, 2),
    snippet: words(random, 8),
    unreadCount: i % 7,
  }))
}
