import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Electron's module is CommonJS, and the ESM loader cannot see named exports through it.
// The default import plus a destructure is the form that works under both loaders.
import electron from 'electron'

const { app, BrowserWindow, MessageChannelMain, ipcMain, session, shell } = electron

import type { Request } from '@session/client'

import { createBridge } from './bridge'
import { serveFiles } from './files'
import { registerMediaScheme, serveMedia } from './media'
import {
  applyContentProtection,
  denyAllPermissions,
  guardNavigation,
  hardenedWebPreferences,
  refuseNewContents,
} from './security'

/**
 * What the app calls itself, which decides where its data lives.
 *
 * Without this it is "Electron": `app.getName()` falls back to that, so the database lands in
 * `~/.config/Electron` beside every other Electron project on the machine - and the scoped
 * package name grows a second, half-used `~/.config/@session/desktop` next to it. Set before
 * anything reads a path, because `userData` is resolved on first use and then fixed.
 *
 * Deliberately not "Session": the shipped client already owns that directory, and a dev build
 * that opened the real client's data would be a bad afternoon. A placeholder until somebody
 * decides on branding, not a name anyone chose.
 */
app.setName('session-app')

const here = fileURLToPath(new URL('.', import.meta.url))

// Before whenReady, which is the only point Electron accepts a privileged scheme.
registerMediaScheme()

/**
 * The bridge, which outlives any particular window.
 *
 * **The main process owns it.** libsession lives here rather than in the renderer because this is
 * where the database key, the user-data directory and the shutdown ordering already are, and
 * because a renderer cannot load a native addon anyway. The renderer only ever sees an ordered
 * stream of frames over a MessagePort, so moving the bridge into a utility process later would
 * not change a line of it.
 *
 * `app.on('activate')` opens a window when the last one has gone, which on macOS is the ordinary
 * way an app comes back from the dock. A bridge owned by a window would reopen libsession's
 * database there instead of carrying on with the one already open, so it is built once, every
 * window is wired to it, and it is closed when the app quits.
 */
let bridge: Awaited<ReturnType<typeof createBridge>> | null = null

async function requireBridge(): Promise<NonNullable<typeof bridge>> {
  if (bridge === null) {
    bridge = await createBridge()
    // With the bridge rather than with a window: `protocol.handle` installs one handler for the
    // whole session, and the scheme has to outlive a window for the same reason the bridge does.
    serveMedia(bridge)
  }
  return bridge
}

async function createWindow(): Promise<Electron.BrowserWindow> {
  const open = await requireBridge()

  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 380,
    // Onboarding's wide column is a fixed 340-tall block, and the frame comes out of this rather
    // than sitting outside it -- about 28 on macOS -- so 380 is the smallest window it still fits
    // in. A floor rather than a scrolling column: a registration form that scrolls is worse than
    // one that cannot be made silly-small.
    minHeight: 380,
    // Linux and Windows take the window icon from here; macOS ignores it and uses the bundle's,
    // which is the packager's job rather than this file's.
    icon: join(here, '../../resources/icon.png'),
    // Shown straight away rather than on ready-to-show: that event is not dependable on a
    // headless display, and a window that never shows has no layout, which makes every element
    // in it invisible to a test.
    show: true,
    webPreferences: {
      ...hardenedWebPreferences({ packaged: app.isPackaged }),
      // CommonJS, because a sandboxed preload cannot be an ES module; it is built that way in
      // electron.vite.config.ts. The preload needs nothing from Node, so the sandbox costs nothing.
      preload: join(here, '../preload/index.cjs'),
    },
  })

  // The dev server when electron-vite sets it, the built file otherwise. Resolved once because
  // the navigation guard has to allow exactly what the window is about to load: computing it
  // twice is how the guard comes to refuse the app's own reload.
  const appUrl =
    process.env['ELECTRON_RENDERER_URL'] ??
    pathToFileURL(join(here, '../renderer/index.html')).toString()

  guardNavigation(window.webContents, appUrl)
  applyContentProtection(window, process.platform)

  /**
   * Nothing opens a window here, whatever asks.
   *
   * An Electron `BrowserWindow` is a chromeless frame with no address bar, no extensions and
   * none of the browser's own protections, so a page opened in one is worse than the same page
   * in a real browser however it got there.
   *
   * **Refusing is all this does.** Shelling the URL out from here would make the handler the way
   * links are opened, and it fires for every `window.open` the page performs -- including a
   * `target="_blank"` inside content the app did not write. What leaves for the browser goes
   * through `open-external` below, which only the app's own code calls.
   */
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  // One MessagePort, which is FIFO: libsession's ordering survives the process boundary,
  // which is the whole reason responses and events share a single stream.
  let port: InstanceType<typeof MessageChannelMain>['port1'] | null = null

  // A channel per load: transferring port2 neuters it, so a reloaded document needs a new one.
  function openChannel(): void {
    port?.close()
    const { port1, port2 } = new MessageChannelMain()
    port = port1

    // A frame is a plain object built by the addon; structured clone carries it to the renderer.
    open.setSink((frame) => {
      port?.postMessage(frame)
    })
    port1.on('message', (event: { data: unknown }) => {
      // Renderer input: an exception escaping here is an uncaught one in the main process.
      try {
        open.send(event.data as Request)
      } catch {
        // No id to answer on, so there is nobody to tell.
      }
    })
    port1.start()
    window.webContents.postMessage('session-bridge-port', null, [port2])
  }

  window.webContents.on('did-finish-load', openChannel)

  // **The port, and not the bridge.** The port is this window's, and nothing loads after a close
  // to retire it, so without this the last one of every window stays open. The bridge is the
  // app's -- a window being replaced must not take libsession down with the outgoing one -- and it
  // is closed on 'before-quit'.
  window.on('closed', () => {
    port?.close()
    port = null
  })

  await window.loadURL(appUrl)

  return window
}

// Covers any WebContents the app did not make. Deliberately not guardNavigation: this fires from
// inside `new BrowserWindow`, before the window has a URL, so a navigation guard installed here
// could only refuse every navigation - including the app's own reload. createWindow installs that
// half itself, once it knows what the app's URL is.
app.on('web-contents-created', (_event, contents) => {
  refuseNewContents(contents)
})

void app.whenReady().then(async () => {
  denyAllPermissions(session.defaultSession)
  ipcMain.handle('session-ping', () => 'pong')

  /**
   * A link the app decided to hand to the person's browser.
   *
   * Restricted to http(s) here rather than at the caller: `openExternal` gives any scheme to the
   * OS, and a `file:` or a custom scheme reaching it is how a link becomes a launched program.
   * The renderer is not trusted to have checked.
   *
   * Plain http is allowed, which is what all three legacy clients do -- two of them go further
   * and upgrade a scheme-less address to https rather than refusing it. Case-insensitive for the
   * same reason the desktop client's is: a scheme is not case-sensitive, and `HTTP://` silently
   * doing nothing is worse than opening it.
   */
  ipcMain.on('open-external', (_event, url: unknown) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) void shell.openExternal(url)
  })

  serveFiles()
  await createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// The bridge outlives every window, so it is closed here rather than with one of them.
app.on('before-quit', () => {
  bridge?.close()
  bridge = null
})
