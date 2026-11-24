import { memoryPorts, resolveBuildVariant, setPorts, type NotificationTap } from '@session/app'
import { parseNetworkName } from '@session/basic-types'
import { getLocale, subscribeLocale } from '@session/localization'

import { mediaUrl } from '@session/app/mediaUrl'

import { flushLogRecords } from './logs'
import { notificationTap, notificationText } from './notificationText'
import { chooseFiles, releasePreview, toPickedFiles } from './pickedFiles'

const memory = memoryPorts()

/** What main says a click leads to, checked: it came over IPC. */
function tapOf(value: unknown): NotificationTap | null {
  if (typeof value !== 'object' || value === null) return null
  const { kind, conversationId } = value as Record<string, unknown>
  if (kind === 'requests') return { kind }
  if (kind === 'conversation' && typeof conversationId === 'string') return { kind, conversationId }
  return null
}

/**
 * The desktop app's OS ports.
 *
 * Only the ones the walking skeleton needs are real; the rest are the memory
 * implementations, which do nothing rather than pretending. Each becomes an IPC call to the
 * main process as its screen arrives - file pickers and notifications live over there,
 * because that is where Electron's dialog and Notification are.
 */
setPorts(
  memoryPorts({
    notifications: {
      ...memory.notifications,
      post: (notification, { audio }) => {
        window.sessionDesktop.postNotification({
          id: notification.id,
          ...notificationText(notification),
          tap: notificationTap(notification),
          // The OS's own sound, only with the Notifications page's audio switch on.
          silent: !audio,
        })
      },
      remove: (ids) => {
        window.sessionDesktop.removeNotifications(ids)
      },
      preview: (sample) => {
        window.sessionDesktop.postNotification({
          id: 'preview',
          ...sample,
          tap: null,
          silent: false,
        })
        return Promise.resolve()
      },
      onTap: (handler) =>
        window.sessionDesktop.onNotificationTap((tap) => {
          const known = tapOf(tap)
          if (known !== null) handler(known)
        }),
      setBadgeCount: (count) => {
        window.sessionDesktop.setBadgeCount(count)
        return Promise.resolve()
      },
    },
    files: {
      ...memory.files,
      pickFiles: async (options) => toPickedFiles(await chooseFiles(options ?? {})),
      pickImages: async (options) =>
        toPickedFiles(await chooseFiles({ ...options, accept: 'image/*' })),
      droppedFiles: (items) => toPickedFiles(items),
      // A pick is the person's own file, which nothing deletes.
      discardPicked: () => undefined,
      releasePreview,
      chooseExportLocation: (suggestedName) =>
        window.sessionDesktop.chooseExportLocation(suggestedName),
      revealInFolder: async (path) => {
        await window.sessionDesktop.revealInFolder(path)
      },
      saveQrCode: (value, mark) => window.sessionDesktop.saveQrCode(value, mark),
    },
    // Main owns the files, compresses with zlib, and asks where to save; see main/logs.ts.
    logs: {
      retained: () => window.sessionDesktop.retainedLogs(),
      span: (first, last) => window.sessionDesktop.logSpan(first, last),
      deliver: (name, parts) => window.sessionDesktop.exportLogs(name, parts),
      deliversBy: 'saveDialog',
    },
    // Built by main from what only it can read.
    diagnostics: { snapshot: () => window.sessionDesktop.diagnostics() },
    // The scheme the main process registered and serves from the addon - see main/media.ts.
    media: {
      urlFor: (ref) => mediaUrl('attachment', ref),
      thumbhashUrlFor: (ref) => mediaUrl('thumbhash', ref),
      thumbnailUrlFor: (ref) => mediaUrl('thumbnail', ref),
      renditionUrlFor: (ref) => mediaUrl('rendition', ref),
    },
    // The same variable and the same parser the main process uses, inlined at build time.
    network: {
      // The fake is one of the networks, so the same variable that chooses the transport answers
      // this. Substituted at build time, like the netid: the renderer cannot read an environment.
      name:
        import.meta.env.EXPO_PUBLIC_SESSION_FAKE === '1'
          ? 'fake'
          : parseNetworkName(import.meta.env.EXPO_PUBLIC_SESSION_NETID),
    },
    // What main read at launch, then what was substituted at build time: the renderer cannot read
    // the environment, and a packaged build carries nothing from main.
    flags: {
      override: (name) =>
        window.sessionDesktop.launchOverrides[name] ??
        import.meta.env.EXPO_PUBLIC_SESSION_FLAGS?.[name] ??
        null,
    },
    build: {
      version: import.meta.env.EXPO_PUBLIC_SESSION_BUILD_VERSION,
      commit: import.meta.env.EXPO_PUBLIC_SESSION_BUILD_COMMIT,
      buildNumber: null,
      variant: resolveBuildVariant(import.meta.env.EXPO_PUBLIC_SESSION_BUILD_VARIANT, 'desktop'),
      libsessionCommit: import.meta.env.EXPO_PUBLIC_SESSION_LIBSESSION_COMMIT,
    },
    window: {
      // Through main rather than `window.close()`, which on macOS leaves the process running.
      // The records waiting here go first, on the same channel, so a Quit's own line is written.
      close: () => {
        flushLogRecords()
        window.sessionDesktop.quit()
      },
      restart: () => {
        flushLogRecords()
        window.sessionDesktop.restart()
      },
      // Not asked for here: blocking capture of a secret screen is Android's alone, for now.
      preventScreenCapture: null,
      isFocused: () => document.hasFocus(),
      onFocusChange: (handler) => {
        const onFocus = () => handler(true)
        const onBlur = () => handler(false)
        window.addEventListener('focus', onFocus)
        window.addEventListener('blur', onBlur)
        return () => {
          window.removeEventListener('focus', onFocus)
          window.removeEventListener('blur', onBlur)
        }
      },
      keyboardShortcuts: {
        keyNames: window.sessionDesktop.platform === 'darwin' ? 'mac' : 'pc',
        onOpenList: (handler) => window.sessionDesktop.onKeyboardShortcuts(handler),
      },
    },
    linking: {
      /**
       * Handed to the main process, which shells it out to the real browser.
       *
       * Its own channel rather than `window.open`: that fires for anything on the page that opens
       * a window, including a `target="_blank"` in content the app did not write, so using it as
       * the way out would make every such link an external open. This one is called by the app
       * and nothing else. The main process still checks the scheme.
       */
      openUrl: (url) => {
        window.sessionDesktop.openExternal(url)
        return Promise.resolve()
      },
      // No OS settings page for a desktop app to send anybody to; the app's own settings are in
      // the app. Null rather than a no-op, for the reason the row above gives -- see
      // `PlatformPort` in `packages/app/src/ports.ts`, which a screen reads to decide whether to
      // offer the row at all.
      openAppSettings: null,
    },
    clipboard: {
      setString: (value) => window.sessionDesktop.copyText(value),
      // No sensitive flag on a desktop clipboard.
      setSecret: (value) => window.sessionDesktop.copyText(value),
      confirmsCopy: false,
    },
  }),
)

// Main draws the right-click menu, and has no other way to learn the language chosen here.
function shareLocale(): void {
  window.sessionDesktop.setLocale(getLocale())
}
shareLocale()
subscribeLocale(shareLocale)
