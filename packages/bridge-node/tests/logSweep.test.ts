import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'

/**
 * The shim's copy of the log sweep, which the notification extension writes its logs through,
 * against the vectors the TypeScript sweep answers. Skipped when the addon has not been built.
 */
const addon = join(import.meta.dirname, '../build/Release/session_bridge_node.node')
const describeAddon = existsSync(addon) ? describe : describe.skip

interface LogRules {
  sweepLog(salt: Uint8Array, text: string): string
  formatLogPrefix(
    wallMs: number,
    uptimeMs: number,
    level: string,
    category: string,
    op?: string,
  ): string
  escapeLogMessage(text: string): string
}

/** Generated from the TypeScript sweep, which `@session/logging`'s own tests check them against. */
interface Vectors {
  salt: string
  sweep: { input: string; swept: string }[]
  prefixes: {
    wallMs: number
    uptimeMs: number
    level: string
    category: string
    op?: string
    prefix: string
  }[]
  escapes: { text: string; escaped: string }[]
}

const vectors = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../logging/tests/vectors/sweep.json'), 'utf8'),
) as Vectors

describeAddon('the shim log sweep', () => {
  // A skipped suite still runs its body to collect tests, so the load waits for beforeAll.
  let rules: LogRules
  beforeAll(() => {
    rules = createRequire(import.meta.url)(addon) as LogRules
  })
  const salt = Uint8Array.from(vectors.salt.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16))

  it('sweeps as the TypeScript sweep does', () => {
    for (const { input, swept } of vectors.sweep)
      expect(rules.sweepLog(salt, input), input).toBe(swept)
  })

  it('writes the line prefix and escapes as the TypeScript does', () => {
    for (const { wallMs, uptimeMs, level, category, op, prefix } of vectors.prefixes)
      expect(rules.formatLogPrefix(wallMs, uptimeMs, level, category, op)).toBe(prefix)
    for (const { text, escaped } of vectors.escapes)
      expect(rules.escapeLogMessage(text)).toBe(escaped)
  })

  it('refuses a salt too short to key a pseudonym', () => {
    expect(() => rules.sweepLog(new Uint8Array(8), 'text')).toThrow(/16 bytes/)
  })
})
