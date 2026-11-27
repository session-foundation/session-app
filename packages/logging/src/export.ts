import { roughBytes, type Rows, type WithSpan } from '@session/basic-types'

import type { BuildFacts, DatabaseSizes, DeviceFacts, DeviceState, StorageFacts } from './facts'
import { LAUNCH_PREFIX, utcOffset, versionText } from './startup'
import type { SweepCounts } from './sweep'
import type { LogFields } from './values'
import { basicUtc, BUDGET_BYTES, type LogFileInfo } from './writer'

/**
 * One piece of an export file, in order: text the export writes itself, or a log file the platform
 * reads straight off disk. Files are named rather than read into JavaScript because twenty
 * megabytes crossing into a phone's JS thread is the cost the native compressor exists to avoid.
 */
export type ExportPart =
  { text: string } | { file: string; extension?: ExtensionLogDir | undefined }

/**
 * The directories beside the logs where a process without the app's logger writes its runs: the
 * notification extension's. A part naming one is read from there; the native compressors and the
 * desktop's main process allow these and no others, so no part can reach outside the log directory
 * through it (`packages/app/tests/logFileName.contract.test.ts` holds their copies to this list).
 */
export const EXTENSION_LOG_DIRS = ['notification-service'] as const

export type ExtensionLogDir = (typeof EXTENSION_LOG_DIRS)[number]

/** One extension's runs, oldest first, as its directory lists them. */
export interface ExtensionRuns {
  extension: ExtensionLogDir
  files: LogFileInfo[]
}

/** What `exportFileName` makes: the platform and version reduced to `[a-z0-9.-]`, then the time. */
const EXPORT_NAME = /^session-logs-[a-z0-9.-]+-\d{8}T\d{6}Z\.log\.gz$/

/** `session-logs-ios-1.0.0-20261009T074102Z.log.gz`: no spaces, nothing a filesystem refuses. */
export function exportFileName(platform: string, version: string, nowMs: number): string {
  const safe = (text: string): string => text.toLowerCase().replace(/[^a-z0-9.]+/g, '-')
  return `session-logs-${safe(platform)}-${safe(version)}-${basicUtc(nowMs)}.log.gz`
}

/** Whether a name is one `exportFileName` made, so an earlier export can be found and swept. */
export function isExportName(name: string): boolean {
  return EXPORT_NAME.test(name)
}

export interface ExportPlan {
  /** Oldest first, so the export reads in time order. */
  included: LogFileInfo[]
  /** Retained but left out for size, oldest first. */
  omitted: LogFileInfo[]
  bytes: number
}

/**
 * Which files go in: chosen from the newest backwards until the budget is spent, so what is left
 * out is always the oldest. The newest file always goes in, however large.
 */
export function planExport(
  files: readonly LogFileInfo[],
  budgetBytes: number = BUDGET_BYTES,
): ExportPlan {
  const newestFirst = [...files].reverse()
  const included: LogFileInfo[] = []
  let bytes = 0
  for (const file of newestFirst) {
    if (included.length > 0 && bytes + file.sizeBytes > budgetBytes) break
    included.push(file)
    bytes += file.sizeBytes
  }
  return {
    included: included.reverse(),
    omitted: files.slice(0, files.length - included.length),
    bytes,
  }
}

/** Where a config's dump moves from one bucket to the next, in bytes: medium, large, very large. */
type BucketLines = readonly [number, number, number]

/**
 * Each config's lines, drawn by what makes it cost the app. Measured with optimised libsession on
 * an M-series Mac; a slow phone is several times slower.
 *
 * Every change regenerates, pushes and stores the whole config, and the account's other devices
 * merge it whole - so cost grows with size. A push past the storage server's 76.8 kB message
 * limit once compressed, which a dump reaches at about 128 kB, goes as a multipart message.
 */
const BUCKET_LINES: Readonly<Record<string, BucketLines>> = {
  // About 160-220 bytes a contact. Under 20 kB (~100) a change costs a fraction of a millisecond;
  // a regular account stays under 128 kB, one message; past it every change goes multipart, and
  // past 512 kB half a megabyte is uploaded and over 20 ms spent merging a change.
  contacts: [20_000, 128_000, 512_000],
  // Moves on every read, so its cost is that of a contacts change made far more often: a quarter
  // of contacts' lines. About 60-100 bytes a conversation.
  convo_info_volatile: [5_000, 32_000, 128_000],
  // About 215 bytes a group, and every group is a swarm to poll - every 3-30 s in the legacy
  // clients - so it costs by count long before it costs by size: ~10, ~50 and ~200 groups.
  user_groups: [2_000, 10_500, 42_000],
}

/** Profile and device settings: a few hundred bytes whatever the account, so any growth is news. */
const FIXED_SIZE_LINES: BucketLines = [2_000, 8_000, 32_000]

/**
 * A config's size (its dump, in bytes) as how much it is likely to cost the app: small, no cost
 * worth seeing; medium, a regular account's; large, a likely cost; very large, almost certainly
 * one. Not the number, which is close to a count of somebody's contacts or groups.
 */
export function sizeBucket(name: string, bytes: number): string {
  const [medium, large, veryLarge] = BUCKET_LINES[name] ?? FIXED_SIZE_LINES
  if (bytes < medium) return 'small'
  if (bytes < large) return 'medium'
  if (bytes < veryLarge) return 'large'
  return 'very large'
}

/**
 * The fields of a database line - `database open db="48 MB" wal=1204224 shm=32768` - logged when
 * the database opens and when the app goes to the background, as legacy iOS did. The journals are
 * exact, because a WAL that keeps growing between lines is a checkpoint that is not happening; the
 * database itself is rough, like everything that describes how much somebody has.
 */
export function databaseFields(sizes: DatabaseSizes | null): LogFields {
  if (sizes === null) return { db: 'none' }
  return { db: roughBytes(sizes.databaseBytes), wal: sizes.walBytes, shm: sizes.shmBytes }
}

/** What is known at export time. Null is "the platform cannot say"; absent is "does not apply". */
export interface ExportFacts extends BuildFacts, DeviceFacts, DeviceState {
  exportedAtMs: number
  utcOffsetMinutes: number
  network: string
  storage: StorageFacts & { attachmentsLimitBytes: number | null }
  /** Each config and its size; null until libsession reports them. */
  configSizes: ReadonlyArray<{ name: string; bytes: number }> | null
  logs: WithSpan & { plan: ExportPlan }
  /** What the sweep replaced in this run, before the export. */
  redactions: SweepCounts
}

/** Full width, so the header is unmistakably the top of an export and not a launch. */
const RULE = '='.repeat(100)
const LABEL_WIDTH = 15
const NESTED_WIDTH = 15

function row(label: string, value: string): string {
  return `  ${label.padEnd(LABEL_WIDTH)}${value}`
}

/**
 * A heading row and its items, each on its own line beneath it. The values line up within the
 * group, a column further out where a name is longer than the usual width - a config's name,
 * `convo_info_volatile` - rather than running into its value.
 */
function group(label: string, items: Rows): string[] {
  const width = Math.max(NESTED_WIDTH, ...items.map(([name]) => name.length + 2))
  return [`  ${label}`, ...items.map(([name, value]) => `    ${name.padEnd(width)}${value}`)]
}

const rough = (value: number | null): string => (value === null ? 'unknown' : roughBytes(value))

/** The UTC timestamp a log line starts with, readable, or null for a line that has none. */
function lineTime(line: string | null): string | null {
  const match = line === null ? null : /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/.exec(line)
  return match === null ? null : `${match[1] ?? ''} ${match[2] ?? ''}Z`
}

function localTime(ms: number, offsetMinutes: number): string {
  return new Date(ms + offsetMinutes * 60_000).toISOString().slice(11, 16)
}

/**
 * The block at the top of an export, for people: support reads it before anything else.
 *
 * Wrapped in full-width rules so it cannot be mistaken for a launch, whose block opens with only an
 * empty line. One item per line, with lists nested under their heading, because a row of
 * separated values is hard to read. Follows legacy iOS's summary and adds what support has asked
 * for since: the libsession commit, the database's journals, config sizes as buckets, what was left
 * out, and how often the sweep had to step in.
 */
export function exportHeader(facts: ExportFacts): string[] {
  const at = new Date(facts.exportedAtMs).toISOString()
  const { plan } = facts.logs
  const { storage, memory } = facts
  const version = versionText(facts.version, facts.buildNumber)
  const omittedBytes = plan.omitted.reduce((sum, file) => sum + file.sizeBytes, 0)
  const redactions = Object.entries(facts.redactions).filter(([, count]) => count > 0)
  const database = storage.database

  return [
    RULE,
    `Session logs exported ${at.slice(0, 10)} ${at.slice(11, 19)}Z ` +
      `(${localTime(facts.exportedAtMs, facts.utcOffsetMinutes)} local, ${utcOffset(facts.utcOffsetMinutes)})`,
    RULE,
    row('Version', version),
    row('Commit', facts.commit ?? 'unknown'),
    row('libsession', facts.libsessionCommit ?? 'unknown'),
    row('Variant', facts.variant),
    row('Install', facts.install),
    row('Device', facts.model),
    row('OS', facts.os),
    ...facts.platformRows.map(([label, value]) => row(label, value)),
    row('Time', `${facts.locale} · ${utcOffset(facts.utcOffsetMinutes)}`),
    row('Network', facts.network),
    row('Connection', facts.networkType ?? 'unknown'),
    ...group('Memory', [
      ['Used', rough(memory.usedBytes)],
      ['Available', rough(memory.availableBytes)],
      ...(memory.totalBytes === undefined
        ? []
        : [['Total', roughBytes(memory.totalBytes)] as const]),
    ]),
    ...(facts.notifications === undefined ? [] : [row('Notifications', facts.notifications)]),
    ...(facts.permissions === undefined ? [] : group('Permissions', facts.permissions)),
    ...group('Storage', [
      ['Database', database === null ? 'unknown' : roughBytes(database.databaseBytes)],
      ...(database === null
        ? []
        : [['WAL', rough(database.walBytes)] as const, ['SHM', rough(database.shmBytes)] as const]),
      [
        'Attachments',
        rough(storage.attachmentsBytes) +
          (storage.attachmentsLimitBytes === null
            ? ''
            : ` (limit ${roughBytes(storage.attachmentsLimitBytes)})`),
      ],
      ['Free', rough(storage.freeBytes)],
    ]),
    ...(facts.configSizes === null
      ? [row('Config sizes', 'unknown (could not be read)')]
      : facts.configSizes.length === 0
        ? [row('Config sizes', 'none (no account yet)')]
        : group(
            'Config sizes',
            facts.configSizes.map(({ name, bytes }) => [name, sizeBucket(name, bytes)] as const),
          )),
    ...group('Logs', [
      ['Files', String(plan.included.length)],
      ['From', lineTime(facts.logs.firstLine) ?? 'unknown'],
      ['To', lineTime(facts.logs.lastLine) ?? 'unknown'],
      ['Size', roughBytes(plan.bytes)],
      [
        'Left out',
        plan.omitted.length === 0
          ? 'nothing'
          : `${String(plan.omitted.length)} older files (${roughBytes(omittedBytes)})`,
      ],
    ]),
    ...(redactions.length === 0
      ? [row('Redactions', 'none this run')]
      : group(
          'Redactions (this run)',
          redactions.map(([kind, count]) => [kind, String(count)] as const),
        )),
    RULE,
    '',
  ]
}

/**
 * The line before a file that continues a launch past a rotation. A launch's first file needs
 * none: it opens with its own startup block, which is what a reader splits on.
 */
export function continuationLine(name: string): string | null {
  return /-0\.log$/.test(name) ? null : `── continued in ${name}`
}

/** Header, then each file, oldest first: what the platform compresses, in order. */
export function exportParts(header: readonly string[], plan: ExportPlan): ExportPart[] {
  return [
    { text: `${header.join('\n')}\n` },
    ...plan.included.flatMap((file): ExportPart[] => {
      const continued = continuationLine(file.name)
      return continued === null
        ? [{ file: file.name }]
        : [{ text: `${continued}\n` }, { file: file.name }]
    }),
  ]
}

/**
 * The extensions' runs, after the app's own files: each extension under a line saying whose they
 * are, then its runs oldest first, each opening with its own `── Session …` launch line.
 */
export function extensionParts(runs: readonly ExtensionRuns[]): ExportPart[] {
  return runs.flatMap(({ extension, files }): ExportPart[] =>
    files.length === 0
      ? []
      : [
          { text: `${LAUNCH_PREFIX}${extension}: ${String(files.length)} runs, oldest first\n` },
          ...files.map((file): ExportPart => ({ file: file.name, extension })),
        ],
  )
}
