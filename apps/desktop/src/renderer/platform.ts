import { memoryPorts, setPorts } from '@session/app'
import { parseNetworkName } from '@session/basic-types'
import { getLocale, subscribeLocale } from '@session/localization'

import { mediaUrl } from '@session/app/mediaUrl'

import { flushLogRecords } from './logs'

const memory = memoryPorts()

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
    files: {
      // Attaching is not a thing the composer can do yet, so the pickers stay the memory ones
      // rather than becoming two dialogs nothing opens.
      ...memory.files,
      chooseExportLocation: (suggestedName) =>
        window.sessionDesktop.chooseExportLocation(suggestedName),
      revealInFolder: async (path) => {
        await window.sessionDesktop.revealInFolder(path)
      },
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
      previewUrlFor: (ref) => mediaUrl('preview', ref),
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
    // Substituted at build time alongside the netid, because the renderer cannot read the
    // environment. That makes a desktop override a rebuild rather than a relaunch, which main
    // reading it and the preload carrying it across would fix: a flag you cannot flip on someone
    // else's machine does half of what a flag is for.
    flags: {
      override: (name) => import.meta.env.EXPO_PUBLIC_SESSION_FLAGS?.[name] ?? null,
    },
    build: {
      version: import.meta.env.EXPO_PUBLIC_SESSION_BUILD_VERSION,
      commit: import.meta.env.EXPO_PUBLIC_SESSION_BUILD_COMMIT,
      buildNumber: null,
      variant: import.meta.env.EXPO_PUBLIC_SESSION_BUILD_VARIANT || 'unknown',
      libsessionCommit: import.meta.env.EXPO_PUBLIC_SESSION_LIBSESSION_COMMIT,
    },
    window: {
      // One window, so closing it is quitting, and `window.close()` needs no IPC call to do it.
      close: () => {
        window.close()
      },
      restart: () => {
        flushLogRecords()
        window.sessionDesktop.restart()
      },
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
