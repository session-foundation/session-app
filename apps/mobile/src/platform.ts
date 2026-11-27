import {
  VARIANT_TRAITS,
  memoryPorts,
  resolveBuildVariant,
  setPorts,
  type MediaPort,
} from '@session/app'
import { mediaUrl } from '@session/app/mediaUrl'
import { qrCodePng } from '@session/app/qrCodePng'
import { parseNetworkName } from '@session/basic-types'
import { isExportName, logSpan, type DiagnosticsSnapshot } from '@session/logging'
import * as Clipboard from 'expo-clipboard'
import Constants from 'expo-constants'
import * as Sharing from 'expo-sharing'
import { AppState, Linking, Platform, Share } from 'react-native'

import { exportFiles, sweepStagedExports } from './files'
import { flagOverride } from './flagOverrides'
import { endingRun, logDirectory, logFiles, logWriter, lowPowerRows, osName } from './logs'
import { pickers } from './pickers'
import { pushTokens } from './pushTokens'
import { restartProcess, terminateProcess } from './processExit'
import { SessionLogs } from './sessionLogs'
import { attachmentsBytes, databaseSizes } from './storageSizes'
import { readDatabaseKey, writeDatabaseKey } from './storage/databaseKey'
import { SecureScreen } from './secureScreen'
import { plainPath } from './storage/layout'
import { exportsDirectory, File, pushInstallMarker } from './storage/roots'
import { sweepStaged } from './storage/staging'

/** The name the share sheet offers for a QR code. */
const QR_CODE_FILE = 'session-qr-code.png'

/**
 * A QR code a share left behind when the app was killed while its sheet was open. It may be a
 * recovery password's, which is the seed, so it does not wait for the next share to be replaced.
 */
function sweepSharedQrCode(): void {
  try {
    const left = new File(exportsDirectory(), QR_CODE_FILE)
    if (left.exists) left.delete()
  } catch {
    // Nothing to sweep is the common case.
  }
}

/**
 * Which build this is: the Android flavour, which the APK's manifest carries, or how iOS says the
 * app was installed -- both read by `modules/session-logs` -- unless the environment overrides it.
 */
const VARIANT = resolveBuildVariant(
  process.env['EXPO_PUBLIC_SESSION_BUILD_VARIANT'],
  SessionLogs?.buildVariant?.(),
)

/** The scheme, which a native image loader resolves on each platform: Fresco's, and React's. */
const MEDIA: MediaPort = {
  urlFor: (ref) => mediaUrl('attachment', ref),
  thumbhashUrlFor: (ref) => mediaUrl('thumbhash', ref),
  thumbnailUrlFor: (ref) => mediaUrl('thumbnail', ref),
  renditionUrlFor: (ref) => mediaUrl('rendition', ref),
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
    notifications: pushTokens === null ? 'no push service in this build' : 'push service available',
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
    pushTokens,
    pushInstallMarker,
    // A source exists only where the build registered a push service at startup, which on Android
    // it does only when the device has that service too: Play services, or microG.
    fastModeAvailable: pushTokens !== null,
    pushService: VARIANT_TRAITS[VARIANT].pushService,
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
    variant: VARIANT,
    // Stamped from the submodule by metro.config.js, beside the commit.
    libsessionCommit: process.env['EXPO_PUBLIC_SESSION_LIBSESSION_COMMIT'] || null,
  },
  share: {
    // The platform's sheet, with the text alone: no title or subject, which iOS would drop and
    // Android would show as a heading above what was shared.
    shareText: (text) => Share.share({ message: text }).then(() => undefined),
    // A file in the exports directory, as an exported log is, so Android's sheet can take it
    // through expo-sharing's content provider. Unlike a log it is deleted once the sheet is done
    // with it: a recovery password's code is the seed, and no copy of it may outlive the share.
    // The sheet resolves once the app it went to has taken it on iOS, and once Session is back in
    // front on Android.
    shareQrCode: async (value, mark) => {
      const out = new File(exportsDirectory(), QR_CODE_FILE)
      if (out.exists) out.delete()
      await out.write(qrCodePng(value, mark))
      try {
        await Sharing.shareAsync(out.uri, { mimeType: 'image/png', UTI: 'public.png' })
      } finally {
        if (out.exists) out.delete()
      }
    },
  },
  clipboard: {
    setString: (value) => Clipboard.setStringAsync(value).then(() => undefined),
    setSecret: (value) =>
      SecureScreen === null
        ? Clipboard.setStringAsync(value).then(() => undefined)
        : SecureScreen.copySensitive(value),
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
sweepStaged()
sweepSharedQrCode()

/**
 * In front means `active`. `inactive` -- the app switcher, a call coming in, Control Centre over
 * the top -- is not: nothing on screen is being looked at, which is what read receipts and the
 * day's wording ask this about.
 */
const isActive = (state: string | null | undefined): boolean => state === 'active'

/** Whether the app is in front, and word each time that changes. */
const appFocus = {
  isFocused: () => isActive(AppState.currentState),
  onFocusChange: (handler: (focused: boolean) => void) => {
    let focused = isActive(AppState.currentState)
    // Only the changes: AppState also reports `background` straight after `inactive`, which is the
    // same answer twice.
    const subscription = AppState.addEventListener('change', (state) => {
      if (isActive(state) === focused) return
      focused = isActive(state)
      handler(focused)
    })
    return () => {
      subscription.remove()
    }
  },
}

/** How long the flag outlasts its last holder: long enough for a screen to mount again. */
const SECURE_RELEASE_MS = 500
const secureScreen = SecureScreen
let secureHolders = 0
let secureRelease: ReturnType<typeof setTimeout> | null = null
/** Android's secure window flag; null where the module is not in the build. */
const secureWindow =
  secureScreen === null
    ? null
    : (prevented: boolean): Promise<void> => {
        secureHolders = Math.max(0, secureHolders + (prevented ? 1 : -1))
        if (secureRelease !== null) clearTimeout(secureRelease)
        secureRelease = null
        if (secureHolders > 0) return secureScreen.setSecure(true)
        secureRelease = setTimeout(() => {
          secureRelease = null
          if (secureHolders === 0) void secureScreen.setSecure(false)
        }, SECURE_RELEASE_MS)
        return Promise.resolve()
      }

setPorts({
  ...ports,
  files: { ...ports.files, ...pickers, ...exportFiles },
  window: {
    ...ports.window,
    ...appFocus,
    close: endingRun('quit', terminateProcess),
    restart: endingRun('restart', restartProcess),
    preventScreenCapture: secureWindow,
  },
})
