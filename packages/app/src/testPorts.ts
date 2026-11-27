import { unknownDiagnostics } from '@session/logging'

import type { NotificationTap, Ports } from './ports'

/**
 * Ports that do nothing, for tests and for the dev loop before an app has real ones.
 *
 * Having a whole platform be a handful of closures is the point of the ports being an
 * interface: a suite installs these instead of stubbing an OS.
 */
export function memoryPorts(overrides: Partial<Ports> = {}): Ports {
  let databaseKey: Uint8Array | null = null
  const notificationTaps = new Set<(tap: NotificationTap) => void>()
  const focusHandlers = new Set<(focused: boolean) => void>()

  return {
    // Mainnet unless an app says otherwise, so the network overlay stays out of tests and out of
    // the fake. See shouldStampNetwork.
    network: { name: 'mainnet' },
    // No overrides, so every flag reads its default. A test that wants one on passes its own
    // `flags` port rather than reaching for a global.
    flags: { override: () => null },
    secureStore: {
      getDatabaseKey: () => Promise.resolve(databaseKey),
      setDatabaseKey: (key) => {
        databaseKey = key
        return Promise.resolve()
      },
    },
    files: {
      pickFiles: () => Promise.resolve([]),
      pickImages: () => Promise.resolve([]),
      droppedFiles: () => Promise.resolve([]),
      picksAreCopies: false,
      discardPicked: () => undefined,
      releasePreview: () => undefined,
      chooseExportLocation: () => Promise.resolve(null),
      openPath: () => Promise.resolve(),
      revealInFolder: () => Promise.resolve(),
      // Null, not a no-op: a screen offers Save only where there is somewhere to save to.
      saveQrCode: null,
    },
    // No resolver in a test process, so callers draw the file form rather than a broken picture.
    media: {
      urlFor: () => null,
      thumbhashUrlFor: () => null,
      thumbnailUrlFor: () => null,
      renditionUrlFor: () => null,
    },
    mediaProbe: {
      imageSize: () => Promise.resolve(null),
    },
    notifications: {
      // Nothing to choose: see `notificationModesApply`.
      deliveryModes: [],
      // None to name, which is the honest answer for a build with no push service in it.
      pushService: null,
      // Nothing suspends a memory implementation. The mobile app overrides this; desktop is
      // genuinely this case.
      notificationModesApply: false,
      pushTokens: null,
      pushInstallMarker: null,
      soundWhenOpenDefault: false,
      notificationsAllowed: null,
      openSettings: null,
      openChannelSettings: null,
      backgroundActivity: null,
      backgroundRefreshOn: null,
      playSound: null,
      preview: null,
      requestPermission: () => Promise.resolve(true),
      post: null,
      remove: null,
      onTap: (handler) => {
        notificationTaps.add(handler)
        return () => notificationTaps.delete(handler)
      },
      setBadgeCount: () => Promise.resolve(),
    },
    clipboard: {
      setString: () => Promise.resolve(),
      setSecret: () => Promise.resolve(),
      confirmsCopy: false,
    },
    linking: {
      openUrl: () => Promise.resolve(),
      // Null, not a no-op: the language picker reads this as "does the OS have a language screen",
      // and a function that did nothing would answer yes and then do nothing.
      // Same reasoning: desktop has no page to send anybody to, and a function that did nothing
      // would claim it had.
      openAppSettings: null,
    },
    // Null, not a no-op, for the same reason as `openAppSettings`: a screen reads it to decide
    // whether to offer Share at all. The phones install their own.
    share: { shareText: null, shareQrCode: null },
    build: {
      version: '0.0.0',
      commit: null,
      buildNumber: null,
      variant: 'unknown',
      libsessionCommit: null,
    },
    window: {
      // Null, not a no-op: nothing in a test or on a phone can close the app, and a screen asks
      // this port whether to offer the door at all -- see `WindowPort` in `./ports`.
      close: null,
      restart: null,
      preventScreenCapture: null,
      isFocused: () => true,
      onFocusChange: (handler) => {
        focusHandlers.add(handler)
        return () => focusHandlers.delete(handler)
      },
      keyboardShortcuts: null,
    },
    // No files and no way to export: a screen offering Export Logs reads `deliver` to decide.
    logs: {
      extensionRuns: null,
      retained: () => Promise.resolve([]),
      span: () => Promise.resolve({ firstLine: null, lastLine: null }),
      deliver: null,
      deliversBy: 'saveDialog',
    },
    diagnostics: {
      snapshot: () => Promise.resolve({ ...unknownDiagnostics(), platform: 'test', locale: 'en' }),
    },
    ...overrides,
  }
}
