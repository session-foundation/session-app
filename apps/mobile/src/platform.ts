import { memoryPorts, setPorts } from '@session/app'
import { parseNetworkName } from '@session/basic-types'
import * as Clipboard from 'expo-clipboard'
import * as SecureStore from 'expo-secure-store'

const DATABASE_KEY = 'session2.database-key'

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

/**
 * The mobile app's OS ports.
 *
 * Real where a screen has arrived that needs it, and a memory implementation everywhere else.
 *
 * A memory port left in place fails silently on a device: the write lands in a variable, nothing
 * throws, and the screen looks like it worked. So a port stays memory only while nothing on any
 * screen depends on it reaching the OS.
 */
setPorts(
  memoryPorts({
    // No resolver yet: React Native's image loaders take a native plug-in per platform - an
    // RCTImageURLLoader on iOS, a Fresco fetcher on Android - and neither is written. Saying so
    // draws the file form, which works, rather than an image that never loads.
    media: { urlFor: () => null },
    // The same variable and the same parser store.ts gives the transport, so the overlay cannot
    // name a network libsession never attached to. EXPO_PUBLIC_ for the reason store.ts gives.
    network: { name: parseNetworkName(process.env['EXPO_PUBLIC_SESSION_NETID']) },
    clipboard: {
      setString: (value) => Clipboard.setStringAsync(value).then(() => undefined),
      getString: () => Clipboard.getStringAsync(),
    },
    secureStore: {
      async getDatabaseKey() {
        const stored = await SecureStore.getItemAsync(DATABASE_KEY)
        if (stored === null) return null
        return hexToBytes(stored)
      },
      async setDatabaseKey(key) {
        await SecureStore.setItemAsync(DATABASE_KEY, bytesToHex(key))
      },
    },
  }),
)
