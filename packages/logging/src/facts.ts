import type { Rows } from '@session/basic-types'

import type { SweepCounts } from './sweep'

/** What a build says about itself: the same on every launch of it, and in every export. */
export interface BuildFacts {
  version: string
  /**
   * The store build number the phones show after the version -- iOS's `CFBundleVersion`, Android's
   * `versionCode`. Null where there is none, which is the desktop, and a phone whose configuration
   * does not set one.
   */
  buildNumber: string | null
  /**
   * Eight characters, with `-dirty` when the tree had changes on top. Null where the build was not
   * made from a git checkout, rather than a hash it cannot vouch for.
   */
  commit: string | null
  /**
   * The libsession commit the build was made with, stamped from the submodule as the commit is;
   * null outside a git checkout. libsession is the client, so a log has to say which one.
   */
  libsessionCommit: string | null
  /**
   * Which build variant this is -- `play`, `fdroid`, `testFlight`, `desktop` -- by its name in
   * `BUILD_VARIANTS` in `@session/app`, which says how each platform knows. `unknown` where it
   * cannot say, rather than a guess from the platform: two builds of one platform can be different
   * variants.
   */
  variant: string
}

/** What the device says about itself, at launch and again at export. */
export interface DeviceFacts {
  /** Where the OS says the app came from - `testflight`, `Play Store`, `F-Droid` - or `unknown`. */
  install: string
  /** `iPhone17,1`, `Google Pixel 9`, `arm64`. */
  model: string
  /** `iOS 26.1`, `Android 16 (API 36)`, `macOS 15.1`, `Linux 6.8.0-45-generic`. */
  os: string
  locale: string
  /** Rows only some platforms have: Linux's distro and display server, a phone's low power mode. */
  platformRows: Rows
}

/** The app's memory now. Total only where the model does not imply it, which is the desktop. */
export interface MemoryFacts {
  usedBytes: number | null
  availableBytes: number | null
  totalBytes?: number | undefined
}

/** The database's three files, which together say whether checkpointing is keeping up. */
export interface DatabaseSizes {
  databaseBytes: number
  walBytes: number | null
  shmBytes: number | null
}

/** The disk now, measured in the network's own data directory; null where it could not be read. */
export interface StorageFacts {
  database: DatabaseSizes | null
  attachmentsBytes: number | null
  freeBytes: number | null
}

/**
 * What the device is doing when somebody exports their logs. Null is "the platform cannot say";
 * absent is "does not apply".
 */
export interface DeviceState {
  memory: MemoryFacts
  /** `wifi`, `cellular`, `online`... or null where the platform cannot tell. */
  networkType: string | null
  /** Absent where the question does not arise - a desktop has no notification mode. */
  notifications?: string | undefined
  /** Name to state, in display order; absent where the platform asks for none. */
  permissions?: Rows | undefined
  storage: StorageFacts
}

/** What the platform can say about itself and its storage when somebody exports their logs. */
export interface DiagnosticsSnapshot extends DeviceFacts, DeviceState {
  /** `iOS`, `Android`, `macOS`, `Linux`, `Windows`: what the export's file name says. */
  platform: string
  /**
   * What the sweep has replaced, where another process does the sweeping: the desktop's main,
   * which sweeps the renderer's lines and libsession's. Absent where this process sweeps its own.
   */
  redactions?: SweepCounts | undefined
}

/**
 * A snapshot that knows nothing, for when the platform's own could not be taken: the header is the
 * least of what an export is for, so a failure there costs rows rather than the export.
 */
export function unknownDiagnostics(): DiagnosticsSnapshot {
  return {
    platform: 'unknown',
    install: 'unknown',
    model: 'unknown',
    os: 'unknown',
    locale: 'unknown',
    platformRows: [],
    memory: { usedBytes: null, availableBytes: null },
    networkType: null,
    storage: { database: null, attachmentsBytes: null, freeBytes: null },
  }
}
