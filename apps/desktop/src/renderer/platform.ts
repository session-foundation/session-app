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
    network: { name: parseNetworkName(import.meta.env.EXPO_PUBLIC_SESSION_NETID) },
    window: {
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
    clipboard: {
      setString: (value) => navigator.clipboard.writeText(value),
      getString: () => navigator.clipboard.readText(),
    },
  }),
)
