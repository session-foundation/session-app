import { memoryPorts, setPorts } from '@session/app'
import { parseNetworkName } from '@session/basic-types'

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
    // The scheme the main process registered and serves from the addon - see main/media.ts.
    // Built here rather than imported from there: this is the renderer, and main is not on its
    // side of the sandbox.
    media: {
      urlFor: (messageId, index) =>
        `session-media://attachment/${String(messageId)}/${String(index)}`,
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
    // environment. That makes a desktop override a rebuild rather than a relaunch -- worth fixing
    // once the preload has an IPC surface to carry it, since a flag you cannot flip on someone
    // else's machine does half of what a flag is for.
    flags: {
      override: (name) => import.meta.env.EXPO_PUBLIC_SESSION_FLAGS?.[name] ?? null,
    },
    window: {
      // One window, so closing it is quitting. `window.close()` rather than an IPC call because
      // there is no IPC surface in the preload yet and this needs none.
      close: () => {
        window.close()
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
      setString: (value) => navigator.clipboard.writeText(value),
      getString: () => navigator.clipboard.readText(),
    },
  }),
)
