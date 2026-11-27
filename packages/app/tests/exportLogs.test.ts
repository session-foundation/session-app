import { emptyCounts, type ExportPart, type SweepCounts } from '@session/logging'
import { afterEach, describe, expect, it } from 'vitest'

import { exportLogs } from '#src/exportLogs'
import { resetLogger } from '#src/log'
import { resetPorts, setPorts, type Ports } from '#src/ports'
import { memoryPorts } from '#src/testPorts'

/** Any size: what the export does with files does not depend on how big they are. */
const FILE_BYTES = 100

afterEach(() => {
  resetPorts()
  resetLogger()
})

function withLogs(
  deliver: (name: string, parts: readonly ExportPart[]) => Promise<boolean>,
  redactions?: SweepCounts,
  diagnostics?: Ports['diagnostics'],
  extensionRuns: Ports['logs']['extensionRuns'] = null,
) {
  const base = memoryPorts()
  setPorts(
    memoryPorts({
      build: {
        version: '1.2.3',
        commit: 'abc12345',
        buildNumber: null,
        variant: 'development',
        libsessionCommit: '76d93c51',
      },
      logs: {
        retained: () =>
          Promise.resolve([
            { name: 'session-20261008T000000Z-0.log', sizeBytes: FILE_BYTES },
            { name: 'session-20261009T000000Z-0.log', sizeBytes: FILE_BYTES },
          ]),
        span: () =>
          Promise.resolve({
            firstLine: '2026-10-08T00:00:00.000Z first',
            lastLine: '2026-10-09T00:00:09.000Z last',
          }),
        extensionRuns,
        deliver,
        deliversBy: 'saveDialog',
      },
      diagnostics:
        diagnostics ??
        (redactions === undefined
          ? base.diagnostics
          : {
              snapshot: async () => ({ ...(await base.diagnostics.snapshot()), redactions }),
            }),
    }),
  )
}

describe('exportLogs', () => {
  it("adds the extensions' runs after the app's own files, each under whose they are", async () => {
    let parts: readonly ExportPart[] = []
    withLogs(
      (_name, delivered) => {
        parts = delivered
        return Promise.resolve(true)
      },
      undefined,
      undefined,
      () =>
        Promise.resolve([
          {
            extension: 'notification-service',
            files: [
              { name: 'session-20261009T010000Z-0.log', sizeBytes: FILE_BYTES },
              { name: 'session-20261009T020000Z-0.log', sizeBytes: FILE_BYTES },
            ],
          },
        ]),
    )
    expect(await exportLogs()).toBe('exported')
    expect(parts.slice(1)).toEqual([
      { file: 'session-20261008T000000Z-0.log' },
      { file: 'session-20261009T000000Z-0.log' },
      { text: '── notification-service: 2 runs, oldest first\n' },
      { file: 'session-20261009T010000Z-0.log', extension: 'notification-service' },
      { file: 'session-20261009T020000Z-0.log', extension: 'notification-service' },
    ])
  })

  it("exports the app's files when the extensions' runs cannot be listed", async () => {
    let parts: readonly ExportPart[] = []
    withLogs(
      (_name, delivered) => {
        parts = delivered
        return Promise.resolve(true)
      },
      undefined,
      undefined,
      () => Promise.reject(new Error('no app group')),
    )
    expect(await exportLogs()).toBe('exported')
    expect(parts.slice(1)).toEqual([
      { file: 'session-20261008T000000Z-0.log' },
      { file: 'session-20261009T000000Z-0.log' },
    ])
  })
  it('hands the platform a header and every retained file, oldest first', async () => {
    let delivered: { name: string; parts: readonly ExportPart[] } | null = null
    withLogs((name, parts) => {
      delivered = { name, parts }
      return Promise.resolve(true)
    })
    expect(await exportLogs()).toBe('exported')
    const { name, parts } = delivered as unknown as { name: string; parts: readonly ExportPart[] }
    expect(name).toMatch(/^session-logs-test-1\.2\.3-\d{8}T\d{6}Z\.log\.gz$/)
    const header = (parts[0] as { text: string }).text
    expect(header).toContain('  Commit         abc12345')
    expect(header).toContain('  libsession     76d93c51')
    expect(header).toContain('    From           2026-10-08 00:00:00Z')
    expect(header).toContain('    To             2026-10-09 00:00:09Z')
    expect(parts.slice(1)).toEqual([
      { file: 'session-20261008T000000Z-0.log' },
      { file: 'session-20261009T000000Z-0.log' },
    ])
  })

  it("reports the sweep's counts from where the lines were swept, when that is elsewhere", async () => {
    let header = ''
    withLogs(
      (_name, parts) => {
        header = (parts[0] as { text: string }).text
        return Promise.resolve(true)
      },
      { ...emptyCounts(), hex: 12, url: 3 },
    )
    await exportLogs()
    expect(header).toMatch(/^\s+hex\s+12$/m)
    expect(header).toMatch(/^\s+url\s+3$/m)
  })

  it("asks the store for config sizes, and says unknown when it can't answer", async () => {
    let header = ''
    const deliver = (_name: string, parts: readonly ExportPart[]) => {
      header = (parts[0] as { text: string }).text
      return Promise.resolve(true)
    }
    withLogs(deliver)
    await exportLogs({ configSizes: () => Promise.resolve([{ name: 'contacts', bytes: 300 }]) })
    expect(header).toMatch(/^ {4}contacts +small$/m)

    withLogs(deliver)
    // A failed start: the bridge never opened the database, so the call rejects.
    expect(await exportLogs({ configSizes: () => Promise.reject(new Error('no database')) })).toBe(
      'exported',
    )
    expect(header).toContain('  Config sizes   unknown (could not be read)')
  })

  it("asks the store for the attachment cache's limit, and leaves it out when it can't answer", async () => {
    let header = ''
    const deliver = (_name: string, parts: readonly ExportPart[]) => {
      header = (parts[0] as { text: string }).text
      return Promise.resolve(true)
    }
    withLogs(deliver)
    await exportLogs({ attachmentsLimit: () => Promise.resolve(1_000_000_000) })
    expect(header).toMatch(/^ {4}Attachments .*\(limit 1\.0 GB\)$/m)

    // No limit set, and a failed start whose store cannot answer: the row says no limit at all.
    for (const attachmentsLimit of [
      () => Promise.resolve(undefined),
      () => Promise.reject(new Error('no database')),
    ]) {
      withLogs(deliver)
      expect(await exportLogs({ attachmentsLimit })).toBe('exported')
      expect(header).toMatch(/^ {4}Attachments /m)
      expect(header).not.toContain('(limit')
    }
  })

  it('says when the person cancelled, and when the platform failed', async () => {
    withLogs(() => Promise.resolve(false))
    expect(await exportLogs()).toBe('cancelled')
    withLogs(() => Promise.reject(new Error('disk full')))
    expect(await exportLogs()).toBe('failed')
  })

  it('exports the files with unknown rows when the platform cannot describe itself', async () => {
    let delivered: { name: string; parts: readonly ExportPart[] } | null = null
    withLogs(
      (name, parts) => {
        delivered = { name, parts }
        return Promise.resolve(true)
      },
      undefined,
      // Any platform's snapshot can fail: one unreadable file under the attachments is enough.
      { snapshot: () => Promise.reject(new Error('ENOENT: no such file or directory')) },
    )
    expect(await exportLogs()).toBe('exported')
    const { name, parts } = delivered as unknown as { name: string; parts: readonly ExportPart[] }
    expect(name).toMatch(/^session-logs-unknown-1\.2\.3-/)
    const header = (parts[0] as { text: string }).text
    expect(header).toContain('  Device         unknown')
    expect(header).toContain('    Attachments    unknown')
    expect(parts).toHaveLength(3)
  })

  it('is unavailable where the build cannot export', async () => {
    setPorts(memoryPorts())
    expect(await exportLogs()).toBe('unavailable')
  })
})
