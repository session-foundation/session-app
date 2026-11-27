import { randomBytes } from 'node:crypto'
import {
  appendFileSync,
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  statfsSync,
  writeFileSync,
} from 'node:fs'
import { opendir, stat } from 'node:fs/promises'
import { arch, freemem, release, totalmem } from 'node:os'
import { join } from 'node:path'

import electron from 'electron'

import { resolveBuildVariant } from '@session/app/buildVariant'
import { flagOverrideRows } from '@session/app/flags'
import {
  consoleDirectory,
  createLogger,
  databaseFields,
  isExportName,
  libsessionLine,
  logSpan,
  minLevelFromSpec,
  networkRows,
  orderedSink,
  parseRecord,
  startupBlock,
  LOG_FILE_NAME,
  LogWriter,
  Pseudonyms,
  type DatabaseSizes,
  type DiagnosticsSnapshot,
  type ExportPart,
  type LogDirectory,
  type Logger,
} from '@session/logging'

import { networkSettings, sessionDataDir } from './bridge'
import { writeGzip } from './logExport'
import { linuxRows, osText } from './platformRows'
import { isFromAppFrame } from './security'
import { backupRow, excludeUserData, userDataExclusion } from './userData'

const { app, dialog, net } = electron

/**
 * When this process started, which names the launch's file. `process.uptime` rather than the
 * moment this module loads, so the name and the uptime column agree about where zero is.
 */
const launchMs = Date.now() - process.uptime() * 1000

/** Records in one `appendLog` call: the renderer sends one task's lines, and more is a bug. */
const MAX_RECORDS_PER_CALL = 2000
/**
 * How long main holds a line for the renderer's from the same moment: far longer than the trip,
 * since the renderer sends at the end of the task that logged (see renderer/logs.ts), so the file
 * reads in order even when either process is busy.
 */
const RENDERER_HOLD_MS = 1000
const SALT_BYTES = 16
const SALT_FILE = '.salt'

/**
 * The log directory through `fs`, **synchronously on purpose**.
 *
 * A flush is a few kilobytes every two seconds, so blocking main for it costs nothing, and the
 * last flush is the one that matters most: it happens on the way out, where an asynchronous
 * write can be cut off by the process ending before it lands.
 */
function fsDirectory(dir: string): LogDirectory {
  return {
    // An entry that cannot be read - a dangling link, a file another instance removed a moment
    // ago - is left out: failing the listing would leave the whole run on the console.
    list: () =>
      Promise.resolve(
        readdirSync(dir).flatMap((name) => {
          try {
            return [{ name, sizeBytes: statSync(join(dir, name)).size }]
          } catch {
            return []
          }
        }),
      ),
    append: (name, text) => {
      appendFileSync(join(dir, name), text, 'utf8')
      return Promise.resolve()
    },
    remove: (name) => {
      rmSync(join(dir, name), { force: true })
      return Promise.resolve()
    },
    read: (name) => Promise.resolve(readFileSync(join(dir, name), 'utf8')),
    readTail: (name, bytes) => {
      const fd = openSync(join(dir, name), 'r')
      try {
        const sizeBytes = fstatSync(fd).size
        const tail = new Uint8Array(Math.min(bytes, sizeBytes))
        readSync(fd, tail, 0, tail.length, sizeBytes - tail.length)
        return Promise.resolve(tail)
      } finally {
        closeSync(fd)
      }
    },
    readHead: (name, bytes) => {
      const fd = openSync(join(dir, name), 'r')
      try {
        const head = new Uint8Array(bytes)
        return Promise.resolve(head.subarray(0, readSync(fd, head, 0, bytes, 0)))
      } finally {
        closeSync(fd)
      }
    },
  }
}

/**
 * The pseudonym key, made on first use and kept beside the logs.
 *
 * Beside them rather than in the keychain because the logs must never depend on the database or
 * its key, and never inside them: an export carries the files and not this, so nobody holding one
 * can hash a guessed id to find it.
 *
 * Written under another name and renamed into place, so a crash mid-write cannot leave a salt
 * that has to be thrown away. One that cannot be read is replaced all the same, and `replaced`
 * says so: every pseudonym in the files before it stops matching, which a reader has to be told.
 */
function readSalt(dir: string): { salt: Uint8Array; replaced: boolean } {
  const path = join(dir, SALT_FILE)
  let replaced = true
  try {
    const hex = readFileSync(path, 'utf8').trim()
    if (/^[0-9a-f]{32,}$/.test(hex)) {
      return { salt: Uint8Array.from(Buffer.from(hex, 'hex')), replaced: false }
    }
  } catch (error) {
    // Not there yet is the first launch, not a replacement.
    replaced = (error as NodeJS.ErrnoException).code !== 'ENOENT'
  }
  const salt = randomBytes(SALT_BYTES)
  const written = `${path}.tmp`
  writeFileSync(written, salt.toString('hex'), { mode: 0o600 })
  renameSync(written, path)
  return { salt: Uint8Array.from(salt), replaced }
}

export interface MainLogs {
  logger: Logger
  writer: LogWriter
  /** Releases every line held for ordering, for a process about to end. */
  drain: () => void
  dir: string
}

let opened: Promise<MainLogs> | null = null

function friendlyPlatform(): string {
  switch (process.platform) {
    case 'darwin':
      return 'macOS'
    case 'win32':
      return 'Windows'
    case 'linux':
      return 'Linux'
    default:
      return process.platform
  }
}

/** Parts in one export: a header and two per file is about twenty; anything near this is a bug. */
const MAX_PARTS = 256
/** Text the export writes itself - the header and the dividers - per part. */
const MAX_TEXT_PART = 64 * 1024

/** An export's parts as the renderer sent them, or null when anything in them is out of bounds. */
function validParts(parts: unknown): ExportPart[] | null {
  if (!Array.isArray(parts) || parts.length > MAX_PARTS) return null
  const valid: ExportPart[] = []
  for (const part of parts as unknown[]) {
    if (typeof part !== 'object' || part === null) return null
    // No process writes beside the logs on desktop, so no part may name such a directory.
    if ('extension' in part) return null
    const { text, file } = part as { text?: unknown; file?: unknown }
    if (typeof text === 'string' && text.length <= MAX_TEXT_PART) valid.push({ text })
    else if (typeof file === 'string' && LOG_FILE_NAME.test(file)) valid.push({ file })
    else return null
  }
  return valid
}

/**
 * Bytes under a directory, recursively, or null where it cannot be listed. Asynchronous because
 * an attachment store can hold thousands of files, and this runs on the process every window's
 * IPC goes through. A file or folder that goes between the listing and its measurement - libsession
 * removes attachments on its own thread - counts as nothing; a link is not followed.
 */
async function directoryBytes(path: string): Promise<number | null> {
  try {
    let total = 0
    for await (const entry of await opendir(path)) {
      const child = join(path, entry.name)
      if (entry.isDirectory()) {
        total += (await directoryBytes(child)) ?? 0
      } else if (entry.isFile()) {
        total += (await stat(child).catch(() => null))?.size ?? 0
      }
    }
    return total
  } catch {
    return null
  }
}

/** A file's size, or null where it is not there or cannot be read. */
function sizeOf(path: string): number | null {
  try {
    return statSync(path).size
  } catch {
    return null
  }
}

/** The database and its journals, `session.db`, `-wal`, `-shm`; null when there is no database. */
function databaseSizes(dir: string): DatabaseSizes | null {
  const databaseBytes = sizeOf(join(dir, 'session.db'))
  if (databaseBytes === null) return null
  return {
    databaseBytes,
    walBytes: sizeOf(join(dir, 'session.db-wal')),
    shmBytes: sizeOf(join(dir, 'session.db-shm')),
  }
}

/**
 * A line with the database's sizes, at the moments legacy iOS logged them: when it opens and on
 * the way out. Between the two, a WAL that keeps growing is a checkpoint that is not happening.
 */
export function logDatabase(moment: string): void {
  void openLogs().then(({ logger }) => {
    logger.info('storage', `database ${moment}`, databaseFields(databaseSizes(sessionDataDir())))
  })
}

/** `/etc/os-release`, or null where there is none, which is everywhere but Linux. */
function readOsRelease(): string | null {
  try {
    return readFileSync('/etc/os-release', 'utf8')
  } catch {
    return null
  }
}

/**
 * The startup block, written by main rather than the renderer: main starts first, so the block
 * opens the file, and it is written even when the renderer never loads - which is when a log is
 * wanted most.
 */
function mainStartupBlock(writer: LogWriter): string[] {
  const build = __SESSION_BUILD_INFO__
  const network = networkRows(networkSettings())
  return startupBlock({
    launchedAtMs: launchMs,
    version: build.version,
    buildNumber: null,
    commit: build.commit,
    libsessionCommit: build.libsessionCommit,
    variant: resolveBuildVariant(build.variant, 'desktop'),
    install: 'unknown',
    model: arch(),
    os: osText(process.platform, process.getSystemVersion(), release()),
    platformRows: [
      ...linuxRows({
        platform: process.platform,
        env: process.env,
        osRelease: readOsRelease(),
        packaged: app.isPackaged,
      }),
      backupRow(userDataExclusion()),
    ],
    locale: app.getLocale(),
    utcOffsetMinutes: -new Date().getTimezoneOffset(),
    network: network.network,
    transport: network.transport,
    networkSettings: network.networkSettings,
    flagOverrides: flagOverrideRows(build.flags),
    logSpec: network.logSpec,
    previousRun: writer.previousRun,
  })
}

/** What the renderer needs to time its lines; main sweeps and writes them, so that is all. */
interface LogSession {
  /** Main's uptime as the renderer asked, so both processes write one clock. */
  uptimeMs: number
}

/**
 * The logs, opened once per process: `userData/logs`, a new file for this launch.
 *
 * Main writes its own lines straight to the writer, and the renderer's arrive through
 * `serveLogs`. If the directory cannot be made the logger writes to the console alone and says
 * why there, which is all that is left to say it to.
 */
export function openLogs(): Promise<MainLogs> {
  opened ??= (async (): Promise<MainLogs> => {
    const writerOptions = {
      launchMs,
      onError: (error: unknown) => {
        console.error('[logs] a write failed:', error)
      },
    }
    const dir = join(app.getPath('userData'), 'logs')
    let salt: Uint8Array
    let saltReplaced = false
    let writer: LogWriter
    let failure: string | null = null
    try {
      mkdirSync(dir, { recursive: true })
      const read = readSalt(dir)
      salt = read.salt
      saltReplaced = read.replaced
      writer = await LogWriter.open(fsDirectory(dir), writerOptions)
    } catch (error) {
      // Not thrown on: every caller would reject, and nothing would be written anywhere.
      failure = error instanceof Error ? error.message : String(error)
      salt = Uint8Array.from(randomBytes(SALT_BYTES))
      writer = await LogWriter.open(
        consoleDirectory((text) => {
          console.log(text)
        }),
        writerOptions,
      )
    }
    const sink = orderedSink(writer, { holdMs: RENDERER_HOLD_MS })
    const logger = createLogger({
      sink,
      pseudonyms: new Pseudonyms(salt),
      // The spec the bridge is opened with, so what libsession is asked to emit is also kept.
      minLevel: minLevelFromSpec(networkSettings().logSpec),
      now: () => Date.now(),
      uptimeMs: () => process.uptime() * 1000,
      ...(app.isPackaged
        ? {}
        : {
            echo: (_level, line) => {
              console.log(line)
            },
          }),
    })
    // After ready, which is when Electron can say the locale; nothing logs before then.
    await app.whenReady()
    logger.section(mainStartupBlock(writer))
    logger.marker('lifecycle', 'launch', { process: 'main' })
    if (failure !== null) {
      logger.error('logs', 'the log directory could not be opened; lines go to the console', {
        reason: failure,
      })
    }
    // Not awaited: `tmutil` can take ten seconds, and until the log is open every line from both
    // processes waits -- a failed start's among them, which is what an export is for.
    if (userDataExclusion() === 'time-machine') {
      void excludeUserData().then((backupFailure) => {
        if (backupFailure === null)
          logger.info('storage', 'data directory excluded from Time Machine')
        else
          logger.warn('storage', 'the data directory could not be excluded from backup', {
            reason: backupFailure,
          })
      })
    }
    if (saltReplaced) {
      logger.warn(
        'logs',
        'the pseudonym salt could not be read and was replaced; earlier files name ids differently',
      )
    }
    return { logger, writer, dir, drain: () => sink.drain() }
  })()
  return opened
}

/**
 * Everything logged so far, on disk, for a process about to end. One turn of the event loop
 * first, so what libsession said while it closed and what the renderer sent before its window
 * went, both already queued, are logged before the hold is let go.
 */
export async function finishLogs(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve)
  })
  const { drain, writer } = await openLogs()
  drain()
  await writer.flush()
}

/**
 * One of libsession's lines, written here where the addon delivers it rather than sent to the
 * renderer and back: it starts in this process, and the renderer has nothing to add to it.
 */
export function logLibsession(level: string, category: string, message: string): void {
  void openLogs().then(({ logger }) => {
    const line = libsessionLine(level, message)
    logger.log(line.level, category, line.message, undefined, line.op)
  })
}

/** A figure for the export's header, or null where reading it threw. */
function probe<T>(read: () => T): T | null {
  try {
    return read()
  } catch {
    return null
  }
}

/** Longer than any name `exportFileName` makes, and short enough for every filesystem. */
const MAX_EXPORT_NAME = 128

/**
 * The renderer's log calls, on this window's own `ipc`.
 *
 * `log:open` answers with main's clock. `log:append` takes the renderer's lines as records, which
 * main sweeps, renders and writes in time order with its own, so the thread that draws the app
 * never runs the sweep and never holds the pseudonym key. A record is checked field by field on
 * the way in: the renderer is the less trusted of the two processes.
 */
export function serveLogs(window: Electron.BrowserWindow, appUrl: string): void {
  const { ipc } = window.webContents

  ipc.handle('log:open', async (event): Promise<LogSession> => {
    if (!isFromAppFrame(event.senderFrame, appUrl)) throw new Error('refused')
    await openLogs()
    return { uptimeMs: process.uptime() * 1000 }
  })

  ipc.handle('log:retained', async (event) => {
    if (!isFromAppFrame(event.senderFrame, appUrl)) throw new Error('refused')
    const { writer } = await openLogs()
    await writer.flush()
    return writer.files()
  })

  ipc.handle('log:span', async (event, first: unknown, last: unknown) => {
    if (!isFromAppFrame(event.senderFrame, appUrl)) throw new Error('refused')
    if (typeof first !== 'string' || !LOG_FILE_NAME.test(first)) throw new Error('refused')
    if (typeof last !== 'string' || !LOG_FILE_NAME.test(last)) throw new Error('refused')
    const { dir } = await openLogs()
    return logSpan(fsDirectory(dir), first, last)
  })

  /**
   * Asks where, then writes the export there. The dialog is main's rather than the files port's,
   * so the path never reaches the renderer: it hands over the parts and learns only whether the
   * person went through with it.
   */
  ipc.handle('log:export', async (event, name: unknown, parts: unknown) => {
    if (!isFromAppFrame(event.senderFrame, appUrl)) throw new Error('refused')
    const valid = validParts(parts)
    if (
      typeof name !== 'string' ||
      name.length > MAX_EXPORT_NAME ||
      !isExportName(name) ||
      valid === null
    ) {
      throw new Error('refused')
    }
    const { dir, writer } = await openLogs()
    await writer.flush()
    const chosen = await dialog.showSaveDialog(window, {
      defaultPath: join(app.getPath('downloads'), name),
    })
    if (chosen.canceled || chosen.filePath === undefined) return false
    try {
      await writeGzip(chosen.filePath, dir, valid)
    } catch (error) {
      // Not Node's message, which names the path - and the renderer logs whatever it is given,
      // which the sweep cannot recognise as a path. The code says what went wrong.
      const code = (error as { code?: unknown }).code
      // The original as the cause, which stays in this process: across IPC only the message goes.
      throw new Error(
        `the export could not be written${typeof code === 'string' ? `: ${code}` : ''}`,
        { cause: error },
      )
    }
    return true
  })

  /**
   * Every figure read on its own and null where it throws, so a header row the platform could not
   * fill reads `unknown` rather than failing the export it heads.
   */
  ipc.handle('log:diagnostics', async (event): Promise<DiagnosticsSnapshot> => {
    if (!isFromAppFrame(event.senderFrame, appUrl)) throw new Error('refused')
    const { logger } = await openLogs()
    const data = probe(sessionDataDir)
    return {
      install: 'unknown',
      platform: friendlyPlatform(),
      os: probe(() => osText(process.platform, process.getSystemVersion(), release())) ?? 'unknown',
      model: probe(arch) ?? 'unknown',
      locale: probe(() => app.getLocale()) ?? 'unknown',
      platformRows:
        probe(() =>
          linuxRows({
            platform: process.platform,
            env: process.env,
            osRelease: readOsRelease(),
            packaged: app.isPackaged,
          }),
        ) ?? [],
      memory: {
        // Every process the app runs, not only main: the renderer is most of it.
        usedBytes: probe(() =>
          app.getAppMetrics().reduce((sum, metric) => sum + metric.memory.workingSetSize * 1024, 0),
        ),
        availableBytes: probe(freemem),
        totalBytes: probe(totalmem) ?? undefined,
      },
      networkType: probe(() => (net.isOnline() ? 'online' : 'offline')),
      storage: {
        database: data === null ? null : databaseSizes(data),
        attachmentsBytes: data === null ? null : await directoryBytes(join(data, 'attachments')),
        freeBytes: probe(() => {
          const stats = statfsSync(app.getPath('userData'))
          return stats.bavail * stats.bsize
        }),
      },
      // Main sweeps every line on the desktop, the renderer's included, so the counts are here.
      redactions: logger.sweepCounts(),
    }
  })

  ipc.on('log:append', (event, records: unknown) => {
    if (!isFromAppFrame(event.senderFrame, appUrl)) return
    if (!Array.isArray(records) || records.length > MAX_RECORDS_PER_CALL) return
    const accepted = records.map(parseRecord).filter((record) => record !== null)
    void openLogs().then(({ logger }) => {
      for (const record of accepted) {
        // Each on its own, so a record that still manages to throw costs only itself.
        try {
          logger.record(record)
        } catch {
          // Nothing to tell: the renderer sent something no line could be made of.
        }
      }
    })
  })
}
