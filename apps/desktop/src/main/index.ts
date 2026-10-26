import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Electron's module is CommonJS, and the ESM loader cannot see named exports through it.
// The default import plus a destructure is the form that works under both loaders.
import electron from 'electron'

const { app, BrowserWindow, Menu, MessageChannelMain, clipboard, session, shell } = electron

import { createRefusingTransport, type Request } from '@session/client'
import { isCrowdinLocale, setLocale } from '@session/localization'

import { appMenuTemplate } from './appMenu'
import { createBridge } from './bridge'
import { editMenuItems } from './editMenu'
import { serveFiles } from './files'
import { launchColors } from './launchColors'
import { finishLogs, logDatabase, logLibsession, openLogs, serveLogs } from './logs'
import { registerMediaScheme, serveMedia, stopServingMedia } from './media'
import {
  acceptsCopy,
  applyContentProtection,
  denyAllPermissions,
  guardNavigation,
  hardenedWebPreferences,
  isFromAppFrame,
  refuseNewContents,
} from './security'
import { excludeUserData, placeUserData } from './userData'
import {
  gestureStepGate,
  readZoom,
  steppedZoom,
  writeZoom,
  ZOOM_SAVE_DELAY_MS,
  type ZoomStep,
} from './zoom'

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
// Where the name has put it, moved and kept out of backups. See userData.ts.
placeUserData()
void excludeUserData()

// As early as the data directory is known, so the launch marker is the first line of the run.
void openLogs()

const here = fileURLToPath(new URL('.', import.meta.url))

// Before whenReady, which is the only point Electron accepts a privileged scheme.
registerMediaScheme()

/** The content's zoom, which the View menu sets and every window draws at. See `appMenu.ts`. */
let zoom = 1

function zoomFile(): string {
  return join(app.getPath('userData'), 'zoom.json')
}

/** A save waiting for the zoom to settle; see `saveZoomSoon`. */
let zoomSave: ReturnType<typeof setTimeout> | undefined

/** Saves the zoom once it has stopped changing, so a burst of steps is one write, not one each. */
function saveZoomSoon(): void {
  clearTimeout(zoomSave)
  zoomSave = setTimeout(saveZoomNow, ZOOM_SAVE_DELAY_MS)
}

function saveZoomNow(): void {
  if (zoomSave === undefined) return
  clearTimeout(zoomSave)
  zoomSave = undefined
  writeZoom(zoomFile(), zoom)
}

function stepZoom(step: ZoomStep): void {
  const next = steppedZoom(zoom, step)
  if (next === zoom) return
  zoom = next
  saveZoomSoon()
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send('zoom', zoom)
}

/** Wheel and pinch steps, which come in bursts, at most one each interval. */
const takeGestureStep = gestureStepGate()

/** Rebuilt when the language changes, since its labels are drawn here rather than by the page. */
function installAppMenu(): void {
  const template = appMenuTemplate({
    platform: process.platform,
    dev: !app.isPackaged,
    onZoom: stepZoom,
  })
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** A bridge that could not be made, standing in for one: see `createRefusingTransport`. */
function refusingBridge(reason: string): Awaited<ReturnType<typeof createBridge>> {
  const refuse = () => Promise.reject(new Error(`the bridge could not start: ${reason}`))
  return {
    ...createRefusingTransport(reason),
    fetchMedia: refuse,
    fetchThumbhash: refuse,
    fetchThumbnail: refuse,
  }
}

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
    // A bridge that cannot be made is answered for rather than thrown: every request the window
    // sends is refused with why, and the store shows the startup-failure screen. Thrown, it left
    // the app with no window at all.
    bridge = await createBridge().catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error)
      console.error(`[session] the bridge could not start: ${reason}`)
      void openLogs().then(({ logger }) => {
        logger.error('main', 'the bridge could not start', { reason })
      })
      return refusingBridge(reason)
    })
    logDatabase('open')
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
    // Electron's default is white, which is what showed until the page drew: a flash on every
    // launch, in a default theme that is black.
    backgroundColor: launchColors().background,
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

  // On this window's own `ipc` rather than `ipcMain`, so no other WebContents can reach them.
  const { ipc } = window.webContents

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
  ipc.on('open-external', (event, url: unknown) => {
    if (!isFromAppFrame(event.senderFrame, appUrl)) return
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) void shell.openExternal(url)
  })

  const files = serveFiles(window, appUrl)
  serveLogs(window, appUrl)

  // Rejects rather than resolving, so a refused copy is not reported to the person as done.
  ipc.handle('clipboard-write-text', async (event, text: unknown) => {
    const accepted =
      isFromAppFrame(event.senderFrame, appUrl) &&
      acceptsCopy(text, { focused: window.isFocused() })
    if (!accepted) throw new Error('clipboard write refused')
    await clipboard.writeText(text)
  })

  // A fresh process rather than a reloaded window: a reload can keep the renderer, and with it
  // whatever the cleared account left in its memory. See `restart` on the window port.
  ipc.on('restart', (event) => {
    if (!isFromAppFrame(event.senderFrame, appUrl)) return
    // `app.exit` skips `before-quit`, so the run is marked as ending here, and written out before
    // the process goes: otherwise the next launch reports a run that did not end cleanly. The
    // renderer hands over its last records first, on this same channel, so they come before it.
    void openLogs()
      .then(async ({ logger, writer }) => {
        logger.marker('lifecycle', 'restart')
        await writer.flush()
      })
      .finally(() => {
        app.relaunch()
        app.exit(0)
      })
  })

  // The menus are drawn here, so they follow the language the person chose in the app.
  ipc.on('locale', (event, locale: unknown) => {
    if (!isFromAppFrame(event.senderFrame, appUrl)) return
    if (typeof locale === 'string' && isCrowdinLocale(locale)) {
      setLocale(locale)
      installAppMenu()
    }
  })

  // **The browser's zoom stays at 100%, and the page zooms its content.** See `appMenu.ts`. The
  // browser's is pinned on each load because Chromium remembers it per page, and a pinch or a
  // remembered zoom would otherwise shrink the CSS width and flip the layout.
  window.webContents.setVisualZoomLevelLimits(1, 1).catch(() => undefined)
  window.webContents.on('dom-ready', () => {
    window.webContents.setZoomFactor(1)
    window.webContents.send('zoom', zoom)
  })
  // Asked once by the preload, before the page renders, so a saved zoom is the first frame's.
  ipc.on('zoom:current', (event) => {
    event.returnValue = isFromAppFrame(event.senderFrame, appUrl) ? zoom : 1
  })
  // Control and the scroll wheel, or a pinch, which Electron reports rather than acting on.
  window.webContents.on('zoom-changed', (_event, direction) => {
    if (takeGestureStep(Date.now())) stepZoom(direction)
  })

  window.webContents.on('context-menu', (_event, params) => {
    const items = editMenuItems(params)
    if (items.length > 0) Menu.buildFromTemplate(items).popup({ window })
  })

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
    // libsession's log lines are the exception: written here, where they arrive, rather than sent
    // to the renderer to be swept and back again to be written.
    open.setSink((frame) => {
      if (frame.type === 'event' && frame.event.type === 'log') {
        logLibsession(frame.event.level, frame.event.category, frame.event.message)
        return
      }
      files.observe(frame)
      port?.postMessage(frame)
    })
    port1.on('message', (event: { data: unknown }) => {
      // Renderer input: an exception escaping here is an uncaught one in the main process.
      try {
        const request = event.data as Request
        // The one command that names a filesystem path of its own choosing, and `save_attachment`
        // has no containment of its own, so every request passes the gate on its way to the bridge.
        const admitted = files.admit(request)
        if (typeof admitted === 'string') {
          port?.postMessage({ type: 'response', response: { id: request.id, error: admitted } })
          return
        }
        open.send(admitted)
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
  zoom = readZoom(zoomFile())
  installAppMenu()

  await createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

// A process of ours that died, with Chromium's reason: `oom`, `crashed`, `killed`. Otherwise a
// renderer that dies and reloads, or a GPU process that restarts, leaves nothing to say it did.
app.on('render-process-gone', (_event, _contents, details) => {
  void openLogs().then(({ logger }) => {
    logger.marker('lifecycle', 'renderer gone', {
      reason: details.reason,
      exitCode: details.exitCode,
    })
  })
})
app.on('child-process-gone', (_event, details) => {
  void openLogs().then(({ logger }) => {
    logger.marker('lifecycle', 'child process gone', {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
    })
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// The bridge outlives every window, so it is closed here rather than with one of them.
app.on('before-quit', () => {
  // Urgent, so it reaches the disk without waiting for a flush; `will-quit` below writes whatever
  // follows it.
  logDatabase('at quit')
  void openLogs().then(({ logger }) => {
    logger.marker('lifecycle', 'quit')
  })
  stopServingMedia()
  bridge?.close()
  bridge = null
  // A zoom changed in the last moment is still waiting to be saved
  saveZoomNow()
})

/** The longest quitting waits for the log, so a write that never finishes cannot keep it open. */
const QUIT_LOG_CAP_MS = 500
let logFinished = false

// After the windows have closed, with every line logged on the way out - by libsession closing,
// by the renderer before its window went - held for ordering or waiting for a flush. Quitting
// waits for them to reach the disk, once, and then exits.
app.on('will-quit', (event) => {
  if (logFinished) return
  logFinished = true
  event.preventDefault()
  const cap = new Promise<void>((resolve) => {
    setTimeout(resolve, QUIT_LOG_CAP_MS)
  })
  void Promise.race([finishLogs(), cap])
    .catch(() => undefined)
    .finally(() => {
      app.exit(0)
    })
})
