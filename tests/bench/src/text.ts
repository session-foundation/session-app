/**
 * The random source and the word list, in one place.
 *
 * Three benchmarks need to build strings of realistic length - the protobuf fixtures, the render
 * corpus, and the C++ corpus in `packages/bridge-rn/cpp/BenchCorpus.cpp` - and length is the
 * property every one of them is actually sensitive to. Two of the three had their own copy, and
 * the copies had already drifted: the render one was missing two words, so its lists were drawn
 * from a slightly different distribution than the numbers they were compared against.
 *
 * The C++ copy stays a copy on purpose. It is a different language and its whole job is to prove
 * it draws the same lengths as this one, which it cannot do by importing it.
 */

/** Deterministic, so two runs of a suite are comparable. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const WORDS =
  'the a of and to in is it you that he was for on are as with his they at be this from I have or by one had not but what all were we when your can said there use an each which she do how their if will up other about out many then them these so'.split(
    ' ',
  )

export function words(random: () => number, count: number): string {
  const out: string[] = []
  for (let i = 0; i < count; i++) out.push(WORDS[Math.floor(random() * WORDS.length)] as string)
  return out.join(' ')
}
