/**
 * Stands in for the Nitro module so this app can run in Expo Go.
 *
 * `@session/client`'s barrel exports `createNativeBridgeTransport`, Metro resolves the `.native`
 * variant of it, and that imports `@session/bridge-rn` - which needs the Nitro module compiled
 * into the host app. Expo Go has no such module, and the failure is a runtime one at startup:
 * "Failed to get NitroModules".
 *
 * Nothing here measures the bridge, so the import only has to resolve. It throws if anything
 * actually calls it, rather than returning something that would fail later and further away.
 */
export function createSessionBridge(): never {
  throw new Error('The bench measures the JavaScript half only; there is no native bridge here.')
}
