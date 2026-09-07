import { NativeModules, Platform } from 'react-native'

import type { BenchRow } from './run'

/**
 * Sends the results back to whoever is running the dev server.
 *
 * Reading a table of fractional milliseconds off a phone screen and typing it somewhere is how
 * a transposed digit gets into a decision. The host is taken from Metro's own script URL rather
 * than configured: the phone already knows which machine it is talking to, and a hardcoded IP
 * would be wrong on every network but one.
 *
 * Best effort by design. There may be no collector listening, and the benchmark is still useful
 * when there is not - the table is on screen either way.
 */
export function collectorUrl(): string | null {
  const source = (NativeModules as { SourceCode?: { scriptURL?: string } }).SourceCode
  const scriptUrl = source?.scriptURL
  if (!scriptUrl) return null
  const host = /^https?:\/\/([^/:]+)/.exec(scriptUrl)?.[1]
  return host ? `http://${host}:19999/results` : null
}

export async function sendResults(rows: BenchRow[]): Promise<'sent' | 'no collector' | 'failed'> {
  const url = collectorUrl()
  if (!url) return 'no collector'

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        platform: Platform.OS,
        version: String(Platform.Version),
        engine: (globalThis as { HermesInternal?: unknown }).HermesInternal ? 'Hermes' : 'JSC',
        rows,
      }),
    })
    return response.ok ? 'sent' : 'failed'
  } catch {
    return 'failed'
  }
}
