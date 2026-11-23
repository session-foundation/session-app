import type { Rows } from '@session/basic-types'
import type { DeviceFacts, ExportPart, PreviousExit } from '@session/logging'
import { requireOptionalNativeModule } from 'expo'

/** What `modules/session-logs` reports; nulls where the platform cannot say. */
interface NativeDiagnostics extends Pick<DeviceFacts, 'model' | 'install'> {
  usedBytes: number | null
  availableBytes: number | null
  totalBytes: number | null
  freeBytes: number | null
  /** Null where the platform could not say. */
  lowPowerMode: boolean | null
  permissions: Rows
  /** iOS only: an iPad build running on a Mac, where the OS that matters is macOS. */
  iOSAppOnMac?: boolean | undefined
}

interface SessionLogsModule {
  gzip(parts: readonly ExportPart[], directory: string, outPath: string): Promise<number>
  diagnostics(): Promise<NativeDiagnostics>
  /**
   * Android only, so absent on iOS: how the system says the previous process ended. Null below
   * Android 11, which keeps no record, and where there is none to read.
   */
  previousExit?: (() => Promise<PreviousExit | null>) | undefined
  /**
   * The Android flavour the APK was built as, or how iOS says the app was installed; null where
   * the APK carries none. Absent in a dev client built before it existed.
   */
  buildVariant?: (() => string | null) | undefined
  /** Android only: the system asking for memory back, by `onTrimMemory` level. */
  addListener(
    event: 'onMemoryPressure',
    listener: (pressure: { level: string }) => void,
  ): { remove(): void }
}

/**
 * The logs' native half: compression off the JS thread, and the device facts JavaScript cannot
 * read. See `modules/session-logs`.
 *
 * Null in a build made before the module existed, so the export is left out rather than offered
 * and then failing.
 */
export const SessionLogs = requireOptionalNativeModule<SessionLogsModule>('SessionLogs')
