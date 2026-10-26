/**
 * The zone matrix: which module may be imported from where.
 *
 * This is the editor-facing half of boundary enforcement - it fires while you type and the
 * message names the sanctioned alternative. The authority is dependency-cruiser
 * (tooling/depcruise-config/root.cjs), which sees the whole graph at once and runs in CI.
 * Both are kept in step deliberately: a rule that only exists here is a rule that only
 * exists for whoever has the editor plugin installed.
 */

/** @type {(patterns: Array<{group: string[], message: string}>, paths?: Array<{name: string, importNames: string[], message: string}>) => import('eslint').Linter.Config['rules']} */
const restrict = (patterns, paths = []) => ({
  'no-restricted-imports': ['error', { patterns, paths }],
})

const NO_TAMAGUI = {
  group: ['tamagui', '@tamagui/*'],
  message: 'Import the wrapper from @session/ui. Only packages/ui may reach for tamagui.',
}
const NO_REACT_NATIVE = {
  group: ['react-native', 'react-native/*'],
  message: 'Wrap it in @session/ui, or put it behind a port in @session/app.',
}
const NO_EXPO = {
  group: ['expo', 'expo-*', 'expo-router'],
  message: 'Expo is mobile-only. Use a port from @session/app, or the nav registry for routing.',
}
const NO_ELECTRON = {
  group: ['electron', 'electron/*'],
  message: 'Only the desktop main and preload processes may import electron.',
}
const NO_ROUTER = {
  group: ['react-router', 'react-router/*', 'react-router-dom'],
  message: 'Build paths with routes.ts and navigate through NavPort.',
}
const NO_BRIDGE_RN = {
  group: ['@session/bridge-rn', '@session/bridge-rn/*'],
  message:
    'Inject a BridgeTransport instead; only packages/client/src/*.native.* links the Nitro module.',
}
const NO_BRIDGE_NODE = {
  group: ['@session/bridge-node', '@session/bridge-node/*'],
  message:
    'Only the desktop main process loads the addon; the renderer talks over the preload bridge.',
}
const NO_FAKE = {
  group: ['@session/client/fake', '@session/client/fake/*'],
  message: 'The fake is for tests and dev entries. Production code takes a SessionClient.',
}
const NO_DEEP = {
  group: ['@session/*/src/*'],
  message: 'Import the package entry point, not a path inside it.',
}

/** Rules that hold everywhere, including apps. */
export const universalZone = restrict([NO_DEEP, NO_FAKE])

/** Shared packages that must run on Hermes, in a browser and in Node alike. */
export const sharedZone = restrict([
  NO_DEEP,
  NO_FAKE,
  NO_TAMAGUI,
  NO_REACT_NATIVE,
  NO_EXPO,
  NO_ELECTRON,
  NO_ROUTER,
  NO_BRIDGE_RN,
  NO_BRIDGE_NODE,
])

/** packages/ui - the one place tamagui and react-native primitives are allowed. */
export const uiZone = restrict([
  NO_DEEP,
  NO_FAKE,
  NO_EXPO,
  NO_ELECTRON,
  NO_ROUTER,
  NO_BRIDGE_RN,
  NO_BRIDGE_NODE,
])

// dependency-cruiser sees modules, not the names imported from them, so only this rule holds it.
const ONLY_GATED_MOBILE_CLIENT = {
  name: '@session/client',
  importNames: ['createSessionClient'],
  message:
    'Build the client with mobileClient() from src/client.ts, which refuses an export to a ' +
    'destination the files port did not stage.',
}

const NO_FILE_SYSTEM = {
  group: ['expo-file-system', 'expo-file-system/*'],
  message:
    "Use the roots from src/storage/: they are the app's only directories that are protected " +
    'and never backed up. See docs/STORAGE.md.',
}

/**
 * apps/mobile - Expo and react-native are its own; electron and the node addon are not, and the
 * file system is reached only through `src/storage/`.
 */
export const mobileAppZone = restrict(
  [NO_DEEP, NO_ELECTRON, NO_ROUTER, NO_BRIDGE_NODE, NO_FILE_SYSTEM],
  [ONLY_GATED_MOBILE_CLIENT],
)

/**
 * apps/mobile/src/storage - the mobile zone less the file-system rule, which it exists to
 * honour. A whole zone rather than an exemption, because a later `no-restricted-imports` replaces
 * an earlier one instead of merging with it.
 */
export const mobileStorageZone = restrict(
  [NO_DEEP, NO_ELECTRON, NO_ROUTER, NO_BRIDGE_NODE],
  [ONLY_GATED_MOBILE_CLIENT],
)

/** The desktop renderer: DOM + react-router, but never electron or the addon directly. */
export const desktopRendererZone = restrict([
  NO_DEEP,
  NO_REACT_NATIVE,
  NO_EXPO,
  NO_ELECTRON,
  NO_BRIDGE_NODE,
  NO_BRIDGE_RN,
])

/** The desktop main/preload processes: electron and the addon live here, UI does not. */
export const desktopMainZone = restrict([
  NO_DEEP,
  NO_TAMAGUI,
  NO_REACT_NATIVE,
  NO_EXPO,
  NO_ROUTER,
  NO_BRIDGE_RN,
])
