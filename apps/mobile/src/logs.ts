import { appLog, logStoreMilestones, startLogger, storeLogger } from '@session/app'
import { roughBytes } from '@session/basic-types'
import {
  consoleDirectory,
  createLogger,
  databaseFields,
  EXTENSION_LOG_DIRS,
  libsessionLine,
  LOG_FILE_NAME,
  LogWriter,
  minLevelFromSpec,
  Pseudonyms,
  sortLogFiles,
  type ExtensionRuns,
  type LogDirectory,
  type LogFields,
} from '@session/logging'
import type { SessionStore } from '@session/state'
import * as Crypto from 'expo-crypto'
import { AppState, Platform } from 'react-native'

import { flagVariables } from './flagOverrides'
import { SessionLogs } from './sessionLogs'
import { databaseSizes } from './storageSizes'
import { checkRoots, File, moveInto, FileMode, logsRoot, type Directory } from './storage/roots'

const SALT_FILE = '.salt'
const SALT_BYTES = 16

/**
 * The zero of the uptime column and the name of this launch's file: when this bundle started
 * running, the nearest thing to the process starting that JavaScript can see.
 *
 * Measured here rather than taken as `performance.now()` alone, because React Native's clock
 * counts from the device booting, not from the app starting.
 */
const launchMs = Date.now()
const launchPerfMs = performance.now()
const uptimeMs = (): number => performance.now() - launchPerfMs

/**
 * The log directory through expo-file-system.
 *
 * An urgent append is written synchronously, on the JS thread: by the time it returns the text has
 * been handed over, so it cannot be lost to the app being suspended before an awaited write
 * resolved. The routine two-second flush is awaited instead, since expo-file-system runs an async
 * write on a native queue of its own, off the JS thread. The rest stays synchronous: deleting,
 * checking and creating files are cheap, and the reads happen at start-up and for an export.
 */
function expoDirectory(dir: Directory): LogDirectory {
  return {
    list: () =>
      Promise.resolve(
        dir
          .list()
          .filter((entry): entry is File => entry instanceof File)
          .map((file) => ({ name: file.name, sizeBytes: file.size })),
      ),
    append: (name, text, urgent) => {
      const file = new File(dir, name)
      if (!file.exists) file.create()
      if (!urgent) return file.write(text, { append: true })
      file.writeSync(text, { append: true })
      return Promise.resolve()
    },
    remove: (name) => {
      const file = new File(dir, name)
      if (file.exists) file.delete()
      return Promise.resolve()
    },
    read: (name) => new File(dir, name).text(),
    readTail: (name, bytes) => {
      const handle = new File(dir, name).open(FileMode.ReadOnly)
      try {
        const sizeBytes = handle.size ?? 0
        const length = Math.min(bytes, sizeBytes)
        handle.offset = sizeBytes - length
        return Promise.resolve(handle.readBytesSync(length))
      } finally {
        handle.close()
      }
    },
    readHead: (name, bytes) => {
      const handle = new File(dir, name).open(FileMode.ReadOnly)
      try {
        return Promise.resolve(handle.readBytesSync(Math.min(bytes, handle.size ?? 0)))
      } finally {
        handle.close()
      }
    },
  }
}

/**
 * The pseudonym key, made on first use and kept beside the logs but never exported with them.
 * See `readSalt` in the desktop's main process for why it is not in the keychain, why it is
 * written under another name and moved into place, and what `replaced` is for.
 */
function readSalt(dir: Directory): { salt: Uint8Array; replaced: boolean } {
  const file = new File(dir, SALT_FILE)
  const replaced = file.exists
  if (replaced) {
    try {
      const hex = file.textSync().trim()
      if (/^[0-9a-f]{32,}$/.test(hex)) {
        const salt = Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16))
        return { salt, replaced: false }
      }
    } catch {
      // Unreadable, so replaced below like a malformed one.
    }
  }
  const salt = Crypto.getRandomBytes(SALT_BYTES)
  const written = new File(dir, `${SALT_FILE}.tmp`)
  if (written.exists) written.delete()
  written.create()
  written.writeSync([...salt].map((byte) => byte.toString(16).padStart(2, '0')).join(''))
  moveInto(written, file, { overwrite: true })
  return { salt, replaced }
}

/**
 * `iOS 26.1`, or `Android 16 (API 36)`: Android's version number alone hides the API level. An
 * iPad build running on a Mac says `macOS (iPad app)`, since it is the Mac's OS that runs it; there
 * is no Catalyst build, so that is the only way this app reaches one.
 */
export function osName(iOSAppOnMac: boolean): string {
  if (Platform.OS === 'android') {
    const release = (Platform.constants as { Release?: string }).Release ?? 'unknown'
    return `Android ${release} (API ${String(Platform.Version)})`
  }
  if (Platform.OS === 'ios') {
    return `${iOSAppOnMac ? 'macOS (iPad app)' : 'iOS'} ${String(Platform.Version)}`
  }
  return `${Platform.OS} ${String(Platform.Version)}`
}

/**
 * The model, where React Native knows it, for a build without `modules/session-logs`. Android
 * reports it; iOS does not, so it says which kind of device and admits the rest.
 */
function fallbackModel(): string {
  if (Platform.OS === 'android') {
    const constants = Platform.constants as { Manufacturer?: string; Model?: string }
    return [constants.Manufacturer, constants.Model].filter(Boolean).join(' ') || 'unknown'
  }
  return `${Platform.OS === 'ios' && Platform.isPad ? 'iPad' : 'iPhone'} (model unknown)`
}

/**
 * A phone's low power mode as a startup and export row; none where the native module could not
 * say. Low power slows background work and the network, which is a question support asks.
 */
export function lowPowerRows(lowPowerMode: boolean | null | undefined): [string, string][] {
  return lowPowerMode === null || lowPowerMode === undefined
    ? []
    : [['Low power', lowPowerMode ? 'on' : 'off']]
}

/**
 * The OS is about to start killing things to get memory back; this app may be next, and a log that
 * ends after this line says why. With what the app is using and what the OS will still give it,
 * where the module can say.
 */
function markMemoryWarning(fields: LogFields): void {
  void (SessionLogs?.diagnostics() ?? Promise.resolve(undefined))
    .catch(() => undefined)
    .then((native) => {
      appLog.marker('lifecycle', 'memory warning', {
        ...fields,
        ...(native === undefined
          ? {}
          : {
              used: native.usedBytes === null ? null : roughBytes(native.usedBytes),
              available: native.availableBytes === null ? null : roughBytes(native.availableBytes),
            }),
      })
    })
}

/** The database's sizes as a line; see `databaseFields`. */
function logDatabase(moment: string): void {
  appLog.info('storage', `database ${moment}`, databaseFields(databaseSizes()))
}

/** The storage module's `logs` root, which the logs create when they open. */
export const logDirectory: Directory = logsRoot

/** The log directory as the writer and the export read it. */
export const logFiles = expoDirectory(logDirectory)

/**
 * The notification extension's runs, which it writes beside the app's logs in the app group with
 * the same prefix and sweep (bridge-core's `RunLog`). iOS only: Android's push handler runs in the
 * app's process, through the app's own logger.
 */
export function extensionRuns(): Promise<ExtensionRuns[]> {
  if (Platform.OS !== 'ios') return Promise.resolve([])
  return Promise.resolve(
    EXTENSION_LOG_DIRS.map((extension) => {
      const dir = logDirectory
        .list()
        .find((entry) => !(entry instanceof File) && entry.name === extension) as
        Directory | undefined
      const files =
        dir === undefined
          ? []
          : dir
              .list()
              .filter((entry): entry is File => entry instanceof File)
              .filter((file) => LOG_FILE_NAME.test(file.name))
              .map((file) => ({ name: file.name, sizeBytes: file.size }))
      return { extension, files: sortLogFiles(files) }
    }),
  )
}

/**
 * The logs: the storage module's `logs` root, a new file for this launch, and the lifecycle
 * markers.
 *
 * Opened at import, before the bridge, so the first line of a run is the app starting rather than
 * whatever the bridge had to say. A directory that cannot be opened leaves the console as the
 * only place lines go, which is said there.
 */

const opened = (async (): Promise<LogWriter> => {
  const writerOptions = {
    launchMs,
    onError: (error: unknown) => {
      console.error('[logs] a write failed:', error)
    },
  }
  let salt: Uint8Array
  let saltReplaced = false
  let writer: LogWriter
  let failure: string | null = null
  try {
    const dir = logDirectory
    if (!dir.exists) dir.create({ intermediates: true })
    const read = readSalt(dir)
    salt = read.salt
    saltReplaced = read.replaced
    writer = await LogWriter.open(logFiles, writerOptions)
  } catch (error) {
    // Not thrown on: the held lines would wait for a logger that never comes.
    failure = error instanceof Error ? error.message : String(error)
    salt = Crypto.getRandomBytes(SALT_BYTES)
    writer = await LogWriter.open(
      consoleDirectory((text) => {
        console.log(text)
      }),
      writerOptions,
    )
  }
  // A row of the startup block, so read before the block is written.
  const storage = checkRoots()
  const logger = createLogger({
    sink: writer,
    pseudonyms: new Pseudonyms(salt),
    uptimeMs,
    // The spec store.ts opens the bridge with, so what libsession is asked to emit is also kept.
    minLevel: minLevelFromSpec(process.env['EXPO_PUBLIC_SESSION_LOG']),
  })
  // The hardware identifier and install source, and on Android how the previous process ended,
  // which only native code can read. A failure here costs the block those facts, never the logger.
  const [native, previousExit] = await Promise.all([
    SessionLogs?.diagnostics().catch(() => undefined),
    SessionLogs?.previousExit?.().catch(() => null),
  ])
  startLogger(logger, {
    launchedAtMs: launchMs,
    model: native?.model ?? fallbackModel(),
    os: osName(native?.iOSAppOnMac === true),
    locale: Intl.DateTimeFormat().resolvedOptions().locale,
    install: native?.install ?? 'unknown',
    platformRows: [...lowPowerRows(native?.lowPowerMode), storage.row],
    // The same variables, literally named, that store.ts opens the bridge with.
    network: {
      fake: process.env['EXPO_PUBLIC_SESSION_FAKE'] === '1',
      netid: process.env['EXPO_PUBLIC_SESSION_NETID'],
      router: process.env['EXPO_PUBLIC_SESSION_ROUTER'],
      devnetSeedUrl: process.env['EXPO_PUBLIC_SESSION_DEVNET_SEED_URL'],
      fileServerUrl: process.env['EXPO_PUBLIC_SESSION_FILE_SERVER_URL'],
      logSpec: process.env['EXPO_PUBLIC_SESSION_LOG'],
    },
    flagVariables: flagVariables(),
    previousRun: writer.previousRun,
    previousExit,
  })
  if (failure !== null) {
    logger.error('logs', 'the log directory could not be opened; lines go to the console', {
      reason: failure,
    })
  }
  for (const warning of storage.warnings) logger.warn('storage', warning)
  if (saltReplaced) {
    logger.warn(
      'logs',
      'the pseudonym salt could not be read and was replaced; earlier files name ids differently',
    )
  }

  // Backgrounding is the last thing a suspended app is told, so its marker is what lets the next
  // launch say whether this one ended or died; the flush is what gets it onto disk in time.
  AppState.addEventListener('change', (state) => {
    if (state === 'active') appLog.marker('lifecycle', 'foreground')
    if (state === 'background') {
      appLog.marker('lifecycle', 'background')
      logDatabase('at background')
      void writer.flush(true)
    }
  })
  // The OS is about to start killing things to get memory back; this one may be next, and a log
  // that ends after this line says why.
  // iOS says so through AppState; Android through the module, since AppState never fires it there.
  AppState.addEventListener('memoryWarning', () => {
    markMemoryWarning({})
  })
  if (Platform.OS === 'android') {
    SessionLogs?.addListener('onMemoryPressure', ({ level }) => {
      markMemoryWarning({ level })
    })
  }
  return writer
})()

/** The writer, once the directory is open; the export flushes and lists through it. */
export const logWriter: Promise<LogWriter> = opened

opened.catch((error: unknown) => {
  console.error('[logs] could not open the log directory:', error)
})

/**
 * Marks the run as ending, writes out what is waiting, then ends it: Quit and Restart end the
 * process at once, and without this the next launch reports a run that did not end cleanly.
 */
export function endingRun(
  marker: 'quit' | 'restart',
  end: (() => void) | null,
): (() => void) | null {
  if (end === null) return null
  return () => {
    appLog.marker('lifecycle', marker)
    void opened.then((writer) => writer.flush()).finally(end)
  }
}

/** The store's milestones as markers, once there is a store. */
export function watchStore(store: SessionStore): void {
  logStoreMilestones(store)
  logDatabase('open')
}

/**
 * The store's `log` option: every line to the file, and in development to the console, which
 * reaches logcat as ReactNativeJS on Android and the device console on iOS.
 */
export const storeLog = storeLogger(__DEV__)

/** The store's `libsessionLog` option: libsession's line, read, then written like the app's own. */
export function libsessionLog(level: string, category: string, message: string): void {
  const line = libsessionLine(level, message)
  storeLog(line.level, category, line.message, line.op)
}
