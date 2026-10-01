/**
 * The renderer draws react-native components through react-native-web, so the aliases
 * below are what let @session/ui and @session/screens - written once, in
 * react-native's vocabulary - render in a browser window.
 *
 * @tamagui/vite-plugin is deliberately absent: it peers on vite 8 and electron-vite is on
 * 7. It is an optimising compiler rather than a requirement, so the app runs without it.
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

import { contentSecurityPolicy } from './src/main/security'

const appDir = fileURLToPath(new URL('.', import.meta.url))

// The renderer's network stamp is substituted at build time from this process's environment, so
// the repo-root .env has to be loaded before the define below reads it. The main process loads it
// again at runtime for its own use: an explicit variable wins in both, so the two agree.
const dotEnv = fileURLToPath(new URL('../../.env', import.meta.url))
if (existsSync(dotEnv)) process.loadEnvFile(dotEnv)

/**
 * The renderer loads from `file:` once packaged, where no response header can carry a CSP, so it
 * has to be a meta tag. Injected rather than written into index.html because the dev server needs
 * a looser one than the shipped app: vite inlines the react-refresh preamble and talks HMR over a
 * websocket, and both are refused by the policy the built app should have.
 */
function contentSecurityPolicyPlugin() {
  return {
    name: 'session-csp',
    transformIndexHtml: {
      order: 'pre' as const,
      handler(html: string, ctx: { server?: unknown }) {
        const policy = contentSecurityPolicy({ dev: ctx.server !== undefined })
        return html.replace(
          '<head>',
          `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
        )
      },
    },
  }
}

/**
 * `.web.js` ahead of `.js`, which is how the react-native-web ecosystem ships a DOM flavour beside
 * a native one. `react-native-svg` - which the icons draw through - is one of the packages that
 * does, and it has no exports map and no `browser` field, so no condition list can reach its web
 * build. Only the extension order can.
 *
 * It has to be given to esbuild as well as to vite. Vite's own resolver reads `resolve.extensions`,
 * but the dependency pre-bundler is esbuild with its own, so left to itself the dev server walks
 * into the native flavour, follows it to `react-native/Libraries/...`, and fails to start on a path
 * the `react-native` alias has rewritten to one that does not exist. The built app resolves
 * correctly either way, which is a good way not to notice.
 */
const WEB_FIRST_EXTENSIONS = [
  '.web.mjs',
  '.web.js',
  '.web.tsx',
  '.web.ts',
  '.mjs',
  '.js',
  '.mts',
  '.ts',
  '.jsx',
  '.tsx',
  '.json',
]

/**
 * The workspace packages ship raw TypeScript - that is what makes editing a screen show up
 * in both apps without a build step - so every build here has to bundle them rather than
 * leave them as imports Node would choke on at runtime.
 */
const workspacePackages = [
  '@session/app',
  '@session/basic-types',
  '@session/bridge-node',
  '@session/bridge-types',
  '@session/client',
  '@session/localization',
  '@session/state',
  '@session/theme-tokens',
]

/**
 * What a flag's environment variable is called, as one string rather than two.
 *
 * The shared table derives the same prefix in `envVarFor`. They were written out separately once
 * and drifted the moment the prefix changed: nothing failed, no flag was collected, and every
 * override on desktop silently read as its default.
 */
const FLAG_PREFIX = 'EXPO_PUBLIC_SESSION_FLAG_'

/**
 * Refuses to build a release with a developer's settings baked into it.
 *
 * The renderer cannot read an environment, so these are substituted here, and the badge that
 * says which network is running is substituted from the same values. A packaged build ignores
 * them at runtime -- so a release carrying one would draw a badge that disagrees with what it
 * is doing: Fake over a real network.
 *
 * Loudly rather than by substituting the default, because somebody who exported one meant
 * something by it.
 */
function refuseDeveloperSettingsInRelease(): void {
  if (process.env['NODE_ENV'] !== 'production') return
  const set = Object.keys(process.env).filter(
    (key) =>
      (key.startsWith(FLAG_PREFIX) || DEVELOPER_SETTINGS.includes(key)) &&
      process.env[key] !== undefined &&
      process.env[key] !== '',
  )
  if (set.length > 0) {
    throw new Error(
      `Refusing to build a release with developer settings in the environment: ${set.join(', ')}. ` +
        'A packaged build ignores these at runtime, so a build that carries them would draw a ' +
        'badge that disagrees with what is running. Unset them and build again.',
    )
  }
}

const DEVELOPER_SETTINGS = [
  'EXPO_PUBLIC_SESSION_FAKE',
  'EXPO_PUBLIC_SESSION_NETID',
  'EXPO_PUBLIC_SESSION_ROUTER',
  'EXPO_PUBLIC_SESSION_LOG',
  'EXPO_PUBLIC_SESSION_DEVNET_SEED_URL',
  'EXPO_PUBLIC_SESSION_FILE_SERVER_URL',
  'EXPO_PUBLIC_SESSION_FILE_SERVER_X25519_PUBKEY',
]

// Before anything below is substituted, so a release cannot carry one of them.
refuseDeveloperSettingsInRelease()

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: workspacePackages })],
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: workspacePackages })],
    // A sandboxed preload has to be CommonJS: Electron loads ES module preloads only with the
    // sandbox off. The main process points at the .cjs this produces.
    build: { rollupOptions: { output: { format: 'cjs' } } },
  },
  renderer: {
    root: 'src/renderer',
    build: {
      outDir: `${appDir}out/renderer`,
      emptyOutDir: true,
      // The CSP's img-src has no data:, so an asset inlined as one would not draw.
      assetsInlineLimit: 0,
      rollupOptions: { input: 'src/renderer/index.html' },
    },
    resolve: {
      alias: { 'react-native': 'react-native-web' },
      // Tamagui ships both; the web build has to win here or the DOM flavour never loads.
      mainFields: ['module', 'browser', 'main'],
      conditions: ['browser', 'import', 'default'],
      extensions: WEB_FIRST_EXTENSIONS,
    },
    optimizeDeps: {
      esbuildOptions: { resolveExtensions: WEB_FIRST_EXTENSIONS },
    },
    define: {
      // The main process reads EXPO_PUBLIC_SESSION_NETID from the environment to pick the netid; the
      // renderer cannot read the environment at all, so it gets the same value substituted here.
      // Both readers have to resolve to one value, or the overlay names a network libsession
      // never attached to.
      'import.meta.env.EXPO_PUBLIC_SESSION_NETID': JSON.stringify(
        process.env['EXPO_PUBLIC_SESSION_NETID'] ?? 'mainnet',
      ),
      // Which bridge the main process will open, substituted for the same reason: the badge that
      // says "this is the fake" must not be able to disagree with what is actually running.
      'import.meta.env.EXPO_PUBLIC_SESSION_FAKE': JSON.stringify(
        process.env['EXPO_PUBLIC_SESSION_FAKE'] ?? '',
      ),
      // Every flag variable present at build time, as one object. Collected by prefix rather than
      // listed, so adding a flag needs no change here -- which is the reason the flag table derives
      // `EXPO_PUBLIC_` on every platform rather than only on the one that needs it. A flag whose
      // name does not start with this is not collected, and a flag that is not collected reads as
      // its default with nothing said.
      'import.meta.env.EXPO_PUBLIC_SESSION_FLAGS': JSON.stringify(
        Object.fromEntries(
          Object.entries(process.env).filter(
            ([key, value]) => key.startsWith(FLAG_PREFIX) && value !== undefined,
          ),
        ),
      ),
      // react-native-web reads these; without them the bundle throws on first render.
      global: 'globalThis',
      __DEV__: JSON.stringify(process.env['NODE_ENV'] !== 'production'),
      'process.env.NODE_ENV': JSON.stringify(process.env['NODE_ENV'] ?? 'development'),
    },
    plugins: [react(), contentSecurityPolicyPlugin()],
  },
})
