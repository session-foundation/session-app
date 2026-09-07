/**
 * Rows to render. Deliberately not the protobuf fixtures: the render benchmark measures React,
 * and building the corpus through a decode would put the thing the other benchmark measures
 * inside this one.
 */
export interface Conversation {
  id: string
  displayName: string
  snippet: string
  unreadCount: number
}

const WORDS =
  'the a of and to in is it you that he was for on are as with his they at be this from have or by one had not but what all were we when your can said there use an each which she do how their if will up other about many then them these so'.split(
    ' ',
  )

export function makeConversations(count: number, seed = 3): Conversation[] {
  let a = seed >>> 0
  const random = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const words = (n: number) =>
    Array.from({ length: n }, () => WORDS[Math.floor(random() * WORDS.length)] as string).join(' ')

  return Array.from({ length: count }, (_, i) => ({
    id: `c${String(i)}`,
    displayName: words(2),
    snippet: words(8),
    unreadCount: i % 7,
  }))
}
