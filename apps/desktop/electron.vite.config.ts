/**
 * The renderer draws react-native components through react-native-web, so the aliases
 * below are what let @session/ui and @session/screens - written once, in
 * react-native's vocabulary - render in a browser window.
 *
 * @tamagui/vite-plugin is deliberately absent: it peers on vite 8 and electron-vite is on
 * 7. It is an optimising compiler rather than a requirement, so the app runs without it.
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { runnerImport } from 'vite'

import { commitStamp, libsessionStamp } from '@session/build-stamp'

import type { LAUNCH_MARK_HEIGHT, SESSION_BRAND } from '@session/ui/brandMark'

import type { launchColors } from './src/main/launchColors'
import { contentSecurityPolicy } from './src/main/security'

const appDir = fileURLToPath(new URL('.', import.meta.url))

// The renderer's network stamp is substituted at build time from this process's environment, so
// the repo-root .env has to be loaded before the define below reads it. The main process loads it
// again at runtime for its own use: an explicit variable wins in both, so the two agree.
const dotEnv = fileURLToPath(new URL('../../.env', import.meta.url))
if (existsSync(dotEnv)) process.loadEnvFile(dotEnv)

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

/** This app's own version, which is the one its builds are released as. */
const version = (
  JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
    version: string
  }
).version

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
 * The launch screen: the brand mark, centred on the default theme, written into the page so that
 * it draws with the page's first frame rather than once the app's script has loaded.
 *
 * Generated here rather than written into index.html so that its colours and outline come from
 * the same sources as the app's: a colour or path copied by hand is one that drifts. Beside
 * `#root` rather than inside it, because React empties its root on the first render -- including
 * the render in which the theme is still being read and nothing is drawn -- and over it, until
 * the renderer removes it once the app has drawn.
 */
async function launchScreenHtml(): Promise<string> {
  // Through vite rather than imported: this file is loaded by Node with every package import left
  // to Node, and the workspace packages are TypeScript with extensionless imports, which it
  // cannot load.
  const inline = { configFile: false as const, root: appDir, logLevel: 'silent' as const }
  const [colors, brand] = await Promise.all([
    runnerImport<{ launchColors: typeof launchColors }>('./src/main/launchColors.ts', inline),
    runnerImport<{
      SESSION_BRAND: typeof SESSION_BRAND
      LAUNCH_MARK_HEIGHT: typeof LAUNCH_MARK_HEIGHT
    }>('@session/ui/brandMark', inline),
  ])
  const { background, mark } = colors.module.launchColors()
  const { width, height, path } = brand.module.SESSION_BRAND
  // `StartingScreen`'s height, which takes over from this on a slow start.
  const markHeight = brand.module.LAUNCH_MARK_HEIGHT
  const markWidth = (markHeight * width) / height
  return [
    `<div id="launch-screen" style="position: fixed; inset: 0; z-index: 1; display: flex;`,
    ` align-items: center; justify-content: center; background: ${background}">`,
    `<svg width="${markWidth}" height="${markHeight}" viewBox="0 0 ${width} ${height}"`,
    ` fill="${mark}" aria-hidden="true"><path d="${path}" /></svg></div>`,
  ].join('')
}

function launchScreenPlugin() {
  let screen: Promise<string> | null = null
  return {
    name: 'session-launch-screen',
    async transformIndexHtml(html: string) {
      const root = '<div id="root"></div>'
      if (!html.includes(root)) {
        throw new Error(`index.html has no ${root} to put the launch screen beside`)
      }
      screen ??= launchScreenHtml()
      return html.replace(root, `${root}\n    ${await screen}`)
    },
  }
}

/**
 * react-native-svg's touch-sound module, swapped for a no-op in the renderer. It is a TurboModule
 * spec, importing `TurboModuleRegistry` from `react-native`, which react-native-web does not
 * export, and the package reaches it only for Android's touch sound, through a lazy `require`. The
 * build merely warns; the dev server's dependency pre-bundler refuses to start. The package imports
 * it by a relative path, which an alias cannot match, so both resolvers are given the swap.
 */
const SVG_SOUND_MODULE = /[\\/]fabric[\\/]NativeSvgSoundModule(\.js)?$/
const svgSoundModuleStub = fileURLToPath(
  new URL('./src/renderer/shims/svgSoundModule.ts', import.meta.url),
)
const svgSoundModuleShim = {
  vite: {
    name: 'svg-sound-module-shim',
    enforce: 'pre' as const,
    resolveId: (source: string) => (SVG_SOUND_MODULE.test(source) ? svgSoundModuleStub : null),
  },
  esbuild: {
    name: 'svg-sound-module-shim',
    setup(build: {
      onResolve: (options: { filter: RegExp }, callback: () => { path: string }) => void
    }) {
      build.onResolve({ filter: SVG_SOUND_MODULE }, () => ({ path: svgSoundModuleStub }))
    },
  },
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
  '@session/logging',
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
  'EXPO_PUBLIC_SESSION_FILE_SERVER_ED25519_PUBKEY',
]

// Before anything below is substituted, so a release cannot carry one of them.
refuseDeveloperSettingsInRelease()

/**
 * What the main process says about the build in the log's startup block, which it writes: the
 * same stamps the renderer gets one by one, as one constant. See `buildInfo.d.ts` in main.
 */
const mainBuildInfo = {
  version,
  commit: commitStamp(appDir),
  libsessionCommit: libsessionStamp(repoRoot),
  // What the build was made as -- `website`, `store`... -- said by whoever assembles it, for the
  // log's startup block. Empty is written as `unknown` rather than guessed at.
  variant: process.env['EXPO_PUBLIC_SESSION_BUILD_VARIANT'] ?? '',
  // Every flag variable present at build time. Collected by prefix rather than listed, so adding a
  // flag needs no change here -- which is the reason the flag table derives `EXPO_PUBLIC_` on every
  // platform rather than only on the one that needs it. A flag whose name does not start with this
  // is not collected, and a flag that is not collected reads as its default with nothing said.
  flags: Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => key.startsWith(FLAG_PREFIX) && value !== undefined,
    ),
  ),
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: workspacePackages })],
    define: { __SESSION_BUILD_INFO__: JSON.stringify(mainBuildInfo) },
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
      alias: {
        'react-native': 'react-native-web',
        // react-native-svg's web build looks images up in React Native's asset registry, a package
        // React Native no longer installs from 0.88. react-native-web's registry is the one the
        // renderer's images are registered with, and has the same `getAssetByID`.
        '@react-native/assets-registry/registry': 'react-native-web/dist/modules/AssetRegistry',
      },
      // Tamagui ships both; the web build has to win here or the DOM flavour never loads.
      mainFields: ['module', 'browser', 'main'],
      conditions: ['browser', 'import', 'default'],
      extensions: WEB_FIRST_EXTENSIONS,
    },
    optimizeDeps: {
      esbuildOptions: {
        resolveExtensions: WEB_FIRST_EXTENSIONS,
        plugins: [svgSoundModuleShim.esbuild],
      },
    },
    define: {
      // The main process reads EXPO_PUBLIC_SESSION_NETID from the environment to pick the netid;
      // the renderer cannot read the environment at all, so it gets the same value substituted
      // here. Both readers have to resolve to one value, or the overlay names a network libsession
      // never attached to.
      'import.meta.env.EXPO_PUBLIC_SESSION_NETID': JSON.stringify(
        process.env['EXPO_PUBLIC_SESSION_NETID'] ?? 'mainnet',
      ),
      // Which bridge the main process will open, substituted for the same reason: the badge that
      // says "this is the fake" must not be able to disagree with what is actually running.
      'import.meta.env.EXPO_PUBLIC_SESSION_FAKE': JSON.stringify(
        process.env['EXPO_PUBLIC_SESSION_FAKE'] ?? '',
      ),
      // The flags, and which build this is, for the settings stamp and anything that has to name
      // its binary: the stamps main's startup block writes, since the renderer can reach neither
      // git, nor its own manifest, nor an environment.
      'import.meta.env.EXPO_PUBLIC_SESSION_FLAGS': JSON.stringify(mainBuildInfo.flags),
      'import.meta.env.EXPO_PUBLIC_SESSION_BUILD_VERSION': JSON.stringify(mainBuildInfo.version),
      'import.meta.env.EXPO_PUBLIC_SESSION_BUILD_COMMIT': JSON.stringify(mainBuildInfo.commit),
      'import.meta.env.EXPO_PUBLIC_SESSION_LIBSESSION_COMMIT': JSON.stringify(
        mainBuildInfo.libsessionCommit,
      ),
      'import.meta.env.EXPO_PUBLIC_SESSION_BUILD_VARIANT': JSON.stringify(mainBuildInfo.variant),
      // react-native-web reads these; without them the bundle throws on first render.
      global: 'globalThis',
      __DEV__: JSON.stringify(process.env['NODE_ENV'] !== 'production'),
      'process.env.NODE_ENV': JSON.stringify(process.env['NODE_ENV'] ?? 'development'),
    },
    plugins: [
      svgSoundModuleShim.vite,
      react(),
      contentSecurityPolicyPlugin(),
      launchScreenPlugin(),
    ],
  },
})
