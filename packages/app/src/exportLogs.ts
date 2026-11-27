import {
  exportFileName,
  exportHeader,
  exportParts,
  extensionParts,
  planExport,
  unknownDiagnostics,
  type ExportFacts,
} from '@session/logging'

import { appLog } from './log'
import { requirePorts } from './ports'

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export type ExportOutcome = 'exported' | 'cancelled' | 'unavailable' | 'failed'

/** Where the export can learn what only libsession knows; any of it may be missing. */
export interface ExportSources {
  /** Each config and its size, from the store. A failed start rejects, and the row says unknown. */
  configSizes?: (() => Promise<readonly { name: string; bytes: number }[]>) | undefined
  /**
   * The attachment cache's limit, from the store: undefined where there is none. A failed start
   * rejects, and the header leaves the limit out.
   */
  attachmentsLimit?: (() => Promise<number | undefined>) | undefined
}

/**
 * Everything the app has logged, as one compressed file handed to the person.
 *
 * The header is built here from the ports, so every platform's says the same things in the same
 * order; the bytes are the platform's to compress and deliver. The `export` marker goes in first,
 * so the file says when it was made and a reader can tell its last lines from what came after.
 *
 * Never throws: a screen offering this is one where something already went wrong, and a second
 * failure should be an outcome it can show rather than another unhandled rejection.
 */
export async function exportLogs(sources: ExportSources = {}): Promise<ExportOutcome> {
  const { logs, diagnostics, build, network } = requirePorts()
  if (logs.deliver === null) return 'unavailable'
  try {
    appLog.marker('export', 'export')
    // The header's facts are the least of what the export is for: a platform that cannot give
    // them costs the header rows, never the files.
    const [files, extensions, snapshot] = await Promise.all([
      logs.retained(),
      // An extension's runs are extra: one that cannot be listed costs those, never the export.
      (logs.extensionRuns?.() ?? Promise.resolve([])).catch((error: unknown) => {
        appLog.warn('export', 'extension logs could not be listed', { reason: reason(error) })
        return []
      }),
      diagnostics.snapshot().catch((error: unknown) => {
        appLog.warn('export', 'diagnostics failed; the header says unknown', {
          reason: reason(error),
        })
        return unknownDiagnostics()
      }),
    ])
    const plan = planExport(files)
    const first = plan.included[0]
    const last = plan.included.at(-1)
    const span =
      first === undefined || last === undefined
        ? { firstLine: null, lastLine: null }
        : await logs.span(first.name, last.name).catch(() => ({ firstLine: null, lastLine: null }))
    const now = Date.now()
    const { platform, redactions, storage, ...device } = snapshot

    const facts: ExportFacts = {
      ...build,
      ...device,
      exportedAtMs: now,
      utcOffsetMinutes: -new Date(now).getTimezoneOffset(),
      network: network.name,
      storage: {
        ...storage,
        attachmentsLimitBytes: (await sources.attachmentsLimit?.().catch(() => null)) ?? null,
      },
      // Unknown rather than empty where it could not be asked: before an account there are none.
      configSizes: (await sources.configSizes?.().catch(() => null)) ?? null,
      logs: { plan, ...span },
      redactions: redactions ?? appLog.sweepCounts(),
    }

    const name = exportFileName(platform, build.version, now)
    const parts = [...exportParts(exportHeader(facts), plan), ...extensionParts(extensions)]
    const delivered = await logs.deliver(name, parts)
    appLog.info('export', delivered ? 'export delivered' : 'export cancelled', {
      files: plan.included.length,
      bytes: plan.bytes,
      extensionRuns: extensions.reduce((sum, { files: runs }) => sum + runs.length, 0),
    })
    return delivered ? 'exported' : 'cancelled'
  } catch (error) {
    appLog.error('export', 'export failed', { reason: reason(error) })
    return 'failed'
  }
}
