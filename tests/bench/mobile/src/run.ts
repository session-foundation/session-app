import { applyEvent, emptyState } from '@session/state'

import { conversationListFrame, makeCorpus } from '../../src/fixtures'
import { loopback } from '../../src/pipeline'

/**
 * The same measurement the desktop run takes, so the two are comparable.
 *
 * It goes through the real `createSessionClient` for the same reason tier one does: `decodeEvent`
 * and the `convert.ts` remap are private to the facade, and a hand-built event would skip them and
 * measure something else. `@session/client` reaches for no node builtin, so it bundles for Metro
 * unchanged - that is the boundary rule paying off.
 */
export interface BenchRow {
  label: string
  kb: number
  decode: number
  project: number
  total: number
}

/**
 * Batched rather than timed one call at a time.
 *
 * `performance.now()` is not guaranteed sub-millisecond under Hermes and `Date.now()` certainly is
 * not, so timing a single 0.5 ms call would read as 0 or 1 and nothing in between. Running a batch
 * and dividing keeps the resolution in the arithmetic instead of in the clock.
 */
function perCall(run: () => void, batch: number): number {
  const clock = (): number =>
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now()

  for (let i = 0; i < Math.min(batch, 5); i++) run()

  const medians: number[] = []
  for (let sample = 0; sample < 5; sample++) {
    const start = clock()
    for (let i = 0; i < batch; i++) run()
    medians.push((clock() - start) / batch)
  }
  medians.sort((a, b) => a - b)
  return medians[Math.floor(medians.length / 2)] ?? 0
}

export function runJsThreadBench(): BenchRow[] {
  const rows: BenchRow[] = []
  const pipe = loopback()

  try {
    for (const n of [100, 500, 1000, 5000]) {
      const { conversations } = makeCorpus({ conversations: n, messages: 0 })
      const bytes = conversationListFrame(conversations)

      // Fewer repetitions as the payload grows, so a slow phone finishes the large sizes.
      const batch = n >= 5000 ? 3 : n >= 1000 ? 10 : 30

      const decode = perCall(() => {
        pipe.push(bytes)
        pipe.drain()
      }, batch)

      pipe.drain()
      pipe.push(bytes)
      const event = pipe.drain()[0]
      if (!event) throw new Error('the frame produced no event')

      const project = perCall(() => {
        applyEvent(emptyState, event)
      }, batch)

      rows.push({
        label: String(n),
        kb: bytes.length / 1024,
        decode,
        project,
        total: decode + project,
      })
    }
  } finally {
    pipe.close()
  }

  return rows
}
