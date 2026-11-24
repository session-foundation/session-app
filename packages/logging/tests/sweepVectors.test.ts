import { describe, expect, it } from 'vitest'

import { capForSweep } from '#src/cap'
import type { LogLevel } from '#src/level'
import { escapeMessage, formatPrefix } from '#src/line'
import { Pseudonyms } from '#src/pseudonym'
import { emptyCounts, sweep } from '#src/sweep'

import json from './vectors/sweep.json'

/**
 * The vectors the notification extension's C++ sweep is held to (`vectors/sweep.json`), checked
 * against the TypeScript they were generated from. A JSON file rather than a module because the
 * addon's tests read it too, and bridge-node may not import this package.
 */
interface Vectors {
  salt: string
  sweep: { input: string; swept: string }[]
  prefixes: {
    wallMs: number
    uptimeMs: number
    level: LogLevel
    category: string
    op?: string
    prefix: string
  }[]
  escapes: { text: string; escaped: string }[]
}

const vectors = json as Vectors
const salt = Uint8Array.from(vectors.salt.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16))

describe('the vectors the native sweep is held to', () => {
  it('are what the sweep answers', () => {
    for (const { input, swept } of vectors.sweep) {
      expect(sweep(capForSweep(input), new Pseudonyms(salt), emptyCounts()), input).toBe(swept)
    }
  })

  it('are what the line prefix and escaping answer', () => {
    for (const { prefix, ...record } of vectors.prefixes) expect(formatPrefix(record)).toBe(prefix)
    for (const { text, escaped } of vectors.escapes) expect(escapeMessage(text)).toBe(escaped)
  })
})
