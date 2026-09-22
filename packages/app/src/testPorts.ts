import type { Ports } from './ports'

/**
 * Ports that do nothing, for tests and for the dev loop before an app has real ones.
 *
 * Having a whole platform be a handful of closures is the point of the ports being an
 * interface: a suite installs these instead of stubbing an OS.
 */
export function memoryPorts(overrides: Partial<Ports> = {}): Ports {
  let databaseKey: Uint8Array | null = null
  let clipboard = ''
  const notificationTaps = new Set<(conversationId: string) => void>()
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
      chooseSaveLocation: () => Promise.resolve(null),
      openPath: () => Promise.resolve(),
      revealInFolder: () => Promise.resolve(),
    },
    // No resolver in a test process, so callers draw the file form rather than a broken picture.
    media: { urlFor: () => null },
    mediaProbe: {
      imageSize: () => Promise.resolve(null),
    },
    notifications: {
      // No push service on any build yet, so onboarding marks fast mode unavailable rather than
      // recommending something that would never arrive.
      fastModeAvailable: false,
      // None to name, which is the honest answer for a build with no push service in it.
      pushService: null,
      // Nothing suspends a memory implementation. The mobile app overrides this; desktop is
      // genuinely this case.
      notificationModesApply: false,
      requestPermission: () => Promise.resolve(true),
      show: () => Promise.resolve(),
      onTap: (handler) => {
        notificationTaps.add(handler)
        return () => notificationTaps.delete(handler)
      },
      setBadgeCount: () => Promise.resolve(),
    },
    clipboard: {
      setString: (value) => {
        clipboard = value
        return Promise.resolve()
      },
      getString: () => Promise.resolve(clipboard),
    },
    linking: {
      openUrl: () => Promise.resolve(),
      // Null, not a no-op: the language picker reads this as "does the OS have a language screen",
      // and a function that did nothing would answer yes and then do nothing.
      // Same reasoning: desktop has no page to send anybody to, and a function that did nothing
      // would claim it had.
      openAppSettings: null,
    },
    window: {
      // Null, not a no-op: nothing in a test or on a phone can close the app, and a screen asks
      // this port whether to offer the door at all -- see `WindowPort` in `./ports`.
      close: null,
      isFocused: () => true,
      onFocusChange: (handler) => {
        focusHandlers.add(handler)
        return () => focusHandlers.delete(handler)
      },
    },
    ...overrides,
  }
}
