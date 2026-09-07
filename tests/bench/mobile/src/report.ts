import { Platform } from 'react-native'

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
function collectorUrl(): string | null {
  // Two routes, because neither is reliable alone. `NativeModules.SourceCode` is absent under the
  // new architecture, which is what made this return null and report "no collector"; RN's own
  // getDevServer is the supported replacement but is an internal path and may move again.
  const candidates: (string | undefined)[] = []

  try {
    // Deliberately require rather than import: this is an internal React Native path that may
    // not exist, and the whole point of the try/catch is to fall through when it does not. A
    // static import would throw while the module loads, before anything can catch it.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const devtools = require('react-native/Libraries/Core/Devtools/getDevServer') as {
      default: () => { url?: string }
    }
    candidates.push(devtools.default().url)
  } catch {
    // Not available; fall through to the older one.
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { NativeModules } = require('react-native') as {
      NativeModules: { SourceCode?: { scriptURL?: string } }
    }
    candidates.push(NativeModules.SourceCode?.scriptURL)
  } catch {
    // Neither route worked; the table on screen is still the result.
  }

  for (const candidate of candidates) {
    const host = candidate ? /^https?:\/\/([^/:]+)/.exec(candidate)?.[1] : undefined
    if (host) return `http://${host}:19999/results`
  }
  return null
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

/** The render numbers, on the same collector as the decode ones. */
export async function sendRenderResults(
  results: { rows: number; mountMs: number; virtualised: boolean; label?: string }[],
): Promise<'sent' | 'no collector' | 'failed'> {
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
        kind: 'render',
        rows: results.map((r) => ({
          label: r.label ?? `${String(r.rows)} ${r.virtualised ? 'windowed' : 'all'}`,
          kb: 0,
          decode: 0,
          project: 0,
          total: r.mountMs,
        })),
      }),
    })
    return response.ok ? 'sent' : 'failed'
  } catch {
    return 'failed'
  }
}
