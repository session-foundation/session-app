import { describe, expect, it } from 'vitest'

import { capForSweep } from '#src/cap'
import { escapeMessage, formatPrefix } from '#src/line'
import { Pseudonyms } from '#src/pseudonym'
import { emptyCounts, sweep } from '#src/sweep'
import { ESCAPE_VECTORS, PREFIX_VECTORS, SWEEP_VECTOR_SALT, SWEEP_VECTORS } from '#src/sweepVectors'

const salt = Uint8Array.from(SWEEP_VECTOR_SALT.match(/../g) ?? [], (pair) =>
  Number.parseInt(pair, 16),
)

describe('the vectors the native sweep is held to', () => {
  it('are what the sweep answers', () => {
    for (const { input, swept } of SWEEP_VECTORS) {
      expect(sweep(capForSweep(input), new Pseudonyms(salt), emptyCounts()), input).toBe(swept)
    }
  })

  it('are what the line prefix and escaping answer', () => {
    for (const { prefix, ...record } of PREFIX_VECTORS) expect(formatPrefix(record)).toBe(prefix)
    for (const { text, escaped } of ESCAPE_VECTORS) expect(escapeMessage(text)).toBe(escaped)
  })
})
