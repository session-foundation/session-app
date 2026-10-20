import { memoryPorts, setPorts, type MediaPort, type NotificationsPort } from '@session/app'
import { mediaUrl } from '@session/app/mediaUrl'
import { parseNetworkName } from '@session/basic-types'
import { isExportName, logSpan, type DiagnosticsSnapshot } from '@session/logging'
import * as Clipboard from 'expo-clipboard'
import Constants from 'expo-constants'
import * as Sharing from 'expo-sharing'
import { Linking, Platform, Share } from 'react-native'

import { exportFiles, sweepStagedExports } from './files'
import { flagOverride } from './flagOverrides'
import { endingRun, logDirectory, logFiles, logWriter, lowPowerRows, osName } from './logs'
import { restartProcess, terminateProcess } from './processExit'
import { SessionLogs } from './sessionLogs'
import { attachmentsBytes, databaseSizes } from './storageSizes'
import { readDatabaseKey, writeDatabaseKey } from './storage/databaseKey'
import { plainPath } from './storage/layout'
import { exportsDirectory, File } from './storage/roots'

/**
 * Whose servers fast mode would use, which is what the onboarding screen has to name.
 *
 * **Not derivable from `Platform.OS`.** iOS is always Apple's, but Android depends on how the
 * build was assembled: a Play build talks to Google and a Huawei build to HMS, and the catalogue
 * carries a separate description of fast mode for each. An environment variable rather than a
 * guess, for the same reason the flags are overridable -- the answer belongs to whoever assembles
 * the build, and nothing here can see it.
 *
 * Google is the Android default because it is the only one wired up so far. An unrecognised value
 * falls back rather than throwing: a typo in a build script should not stop the app starting, and
 * the screen's unqualified description is honest about a mode that is unavailable anyway.
 */
const PUSH_SERVICE: NotificationsPort['pushService'] = ((): NotificationsPort['pushService'] => {
  if (Platform.OS === 'ios') return 'apple'
  const named = process.env['EXPO_PUBLIC_SESSION_PUSH_SERVICE']
  return named === 'huawei' || named === 'google' ? named : 'google'
})()

/** The scheme, which a native image loader resolves on each platform: Fresco's, and React's. */
const MEDIA: MediaPort = {
  urlFor: (ref) => mediaUrl('attachment', ref),
  previewUrlFor: (ref) => mediaUrl('preview', ref),
}

// Hex rather than base64: the keychain stores strings, and hex needs no polyfill on either
// platform's JavaScript engine.
function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

/** Held in a const so the closures below keep its narrowing. */
const nativeLogs = SessionLogs

async function diagnosticsSnapshot(): Promise<DiagnosticsSnapshot> {
  // A native failure is unknown rows in the header, not a failed export: Android's throws when
  // there is no context, and the header is the least of what the export is for.
  const native = await (SessionLogs?.diagnostics() ?? Promise.resolve(undefined)).catch(
    () => undefined,
  )
  return {
    install: native?.install ?? 'unknown',
    platform: Platform.OS === 'ios' ? 'iOS' : 'Android',
    os: osName(native?.iOSAppOnMac === true),
    model: native?.model ?? 'unknown',
    locale: Intl.DateTimeFormat().resolvedOptions().locale,
    platformRows: lowPowerRows(native?.lowPowerMode),
    // No total: the model says how much memory the phone has.
    memory: {
      usedBytes: native?.usedBytes ?? null,
      availableBytes: native?.availableBytes ?? null,
    },
    networkType: null,
    // What the notifications port says, which is what the app will actually do.
    notifications: 'no push service in this build',
    // Capitalised like every other label in the header; the native modules name them in lower case.
    ...(native === undefined
      ? {}
      : {
          permissions: native.permissions.map(
            ([name, state]) => [name.charAt(0).toUpperCase() + name.slice(1), state] as const,
          ),
        }),
    storage: {
      database: databaseSizes(),
      attachmentsBytes: attachmentsBytes(),
      freeBytes: native?.freeBytes ?? null,
    },
  }
}

/**
 * The mobile app's OS ports.
 *
 * Real where a screen has arrived that needs it, and a memory implementation everywhere else.
 *
 * A memory port left in place fails silently on a device: the write lands in a variable, nothing
 * throws, and the screen looks like it worked. So a port stays memory only while nothing on any
 * screen depends on it reaching the OS.
 */
const ports = memoryPorts({
  media: MEDIA,
  // The same variable and the same parser store.ts gives the transport, so the overlay cannot
  // name a network libsession never attached to. EXPO_PUBLIC_ for the reason store.ts gives.
  network: {
    // The same variable `store.ts` reads to decide which bridge to open, so the badge cannot
    // disagree with what is actually running.
    name:
      process.env['EXPO_PUBLIC_SESSION_FAKE'] === '1'
        ? 'fake'
        : parseNetworkName(process.env['EXPO_PUBLIC_SESSION_NETID']),
  },
  // One literal per flag, in `flagOverrides.ts`, because a computed variable name is not a
  // variable Expo carries into the bundle at all.
  flags: { override: flagOverride },
  notifications: {
    // Both mobile operating systems stop the app when it leaves the screen, which is what makes
    // notification delivery something to choose rather than something that just happens. True on
    // a tablet as well as a phone: it is the OS that decides this, not the screen size.
    notificationModesApply: true,
    // TODO: determine this properly per build rather than declaring it false everywhere. It is a
    // fact about what was assembled -- an APNs entitlement on iOS, Play Services or HMS on
    // Android -- so it has to be answered where the build is, not guessed at here. Saying false
    // understates a build that can do it; saying true would offer a mode that silently never
    // delivers, which is the worse of the two while nothing is wired up.
    fastModeAvailable: false,
    pushService: PUSH_SERVICE,
    requestPermission: () => Promise.resolve(true),
    show: () => Promise.resolve(),
    onTap: () => () => undefined,
    setBadgeCount: () => Promise.resolve(),
  },
  build: {
    // The version app.json gives the build, which is what the stores and the OS know it as.
    version: Constants.expoConfig?.version ?? '0.0.0',
    // Inlined by Metro from what its config read out of git. See metro.config.js.
    commit: process.env['EXPO_PUBLIC_SESSION_BUILD_COMMIT'] || null,
    // What app.json gives the native build, or null where it sets none.
    buildNumber:
      Platform.OS === 'ios'
        ? (Constants.expoConfig?.ios?.buildNumber ?? null)
        : Constants.expoConfig?.android?.versionCode === undefined
          ? null
          : String(Constants.expoConfig.android.versionCode),
    // Said by whoever assembles the build, and inlined by Metro like the commit.
    variant: process.env['EXPO_PUBLIC_SESSION_BUILD_VARIANT'] || 'unknown',
    // Stamped from the submodule by metro.config.js, beside the commit.
    libsessionCommit: process.env['EXPO_PUBLIC_SESSION_LIBSESSION_COMMIT'] || null,
  },
  share: {
    // The platform's sheet, with the text alone: no title or subject, which iOS would drop and
    // Android would show as a heading above what was shared.
    shareText: (text) => Share.share({ message: text }).then(() => undefined),
  },
  clipboard: {
    setString: (value) => Clipboard.setStringAsync(value).then(() => undefined),
    // Android 13 (API 33) added the system's own preview of what was copied.
    confirmsCopy: Platform.OS === 'android' && Number(Platform.Version) >= 33,
  },
  linking: {
    // Unchanged, and repeated because a port override replaces the whole object rather than
    // merging into it. See memoryPorts.
    openUrl: (url) => Linking.openURL(url),
    /**
     * Where a permission the OS will not ask about again is turned back on.
     *
     * `openSettings()` rather than a hard-coded `app-settings:` URL, so the constant is read for
     * whichever OS version this is running on rather than hoping a literal stays correct across
     * them. Both platforms: every installed app has a settings page.
     */
    openAppSettings: () => Linking.openSettings(),
  },
  logs: {
    retained: async () => {
      const writer = await logWriter
      await writer.flush()
      return writer.files()
    },
    span: (first, last) => logSpan(logFiles, first, last),
    /**
     * Compressed natively into the storage module's exports directory, then shared, as the legacy
     * clients do, rather than saved through a picker. expo-sharing because Android's sheet takes a
     * file only through a content provider, which it brings; on iOS it is the same activity sheet
     * React Native's own opens.
     *
     * The sheet does not say whether anything was sent, so a closed sheet counts as delivered.
     */
    deliver:
      nativeLogs === null
        ? null
        : async (name, parts) => {
            // Earlier exports go first. Not deleted once shared: on Android the app it was shared
            // to may still be reading it after the sheet closes. So one is kept, not every one.
            const exports = exportsDirectory()
            for (const entry of exports.list()) {
              if (entry instanceof File && isExportName(entry.name)) entry.delete()
            }
            const out = new File(exports, name)
            await nativeLogs.gzip(parts, plainPath(logDirectory.uri), plainPath(out.uri))
            await Sharing.shareAsync(out.uri, {
              mimeType: 'application/gzip',
              UTI: 'org.gnu.gnu-zip-archive',
            })
            return true
          },
    deliversBy: 'shareSheet',
  },
  diagnostics: { snapshot: diagnosticsSnapshot },
  // The same keychain item store.ts opens the database with, so there is one key.
  secureStore: {
    async getDatabaseKey() {
      const stored = await readDatabaseKey()
      if (stored === null) return null
      return hexToBytes(stored)
    },
    setDatabaseKey: (key) => writeDatabaseKey(bytesToHex(key)),
  },
})

sweepStagedExports()

setPorts({
  ...ports,
  // The pickers stay the memory ones until the composer can attach.
  files: { ...ports.files, ...exportFiles },
  window: {
    ...ports.window,
    close: endingRun('quit', terminateProcess),
    restart: endingRun('restart', restartProcess),
  },
})
