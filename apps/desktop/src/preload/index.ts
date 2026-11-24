import type { QrMark } from '@session/basic-types'
import electron from 'electron'

import { readLaunchOverrides } from '../shared/launchOverrides'

const { contextBridge, ipcRenderer, webUtils } = electron

/**
 * Hands the bridge's MessagePort to the page and steps aside.
 *
 * The main process posts the port here because a preload is the only script that can receive
 * one over IPC; the page is the only place that should hold it, because a frame that crossed
 * through the preload would be copied a second time on the way between worlds. So the port goes
 * straight into the main world and the renderer's transport picks it up off `window`.
 *
 * Nothing here needs Node, which is what lets the renderer run sandboxed.
 */
ipcRenderer.on('session-bridge-port', (event) => {
  window.postMessage('session-bridge-port', '*', event.ports)
})

/**
 * The content zoom main last sent, and whoever is listening for the next.
 *
 * Asked for synchronously, once, before the page's script runs, so a saved zoom is how the page
 * first draws; later changes arrive on `zoom`. Kept here because main can send one before the page
 * has subscribed, and a message to a channel with no listener is dropped.
 */
const initialZoom: unknown = ipcRenderer.sendSync('zoom:current')
let zoom =
  typeof initialZoom === 'number' && Number.isFinite(initialZoom) && initialZoom > 0
    ? initialZoom
    : 1
let zoomListener: ((zoom: number) => void) | null = null
ipcRenderer.on('zoom', (_event, next: unknown) => {
  if (typeof next !== 'number' || !Number.isFinite(next) || next <= 0) return
  zoom = next
  zoomListener?.(next)
})

/** Whoever is listening for where a clicked notification leads, which main sends to the page. */
let notificationTapListener: ((tap: unknown) => void) | null = null
ipcRenderer.on('notifications:tap', (_event, tap: unknown) => {
  notificationTapListener?.(tap)
})

/** Whoever is listening for the Help menu's Keyboard Shortcuts, which main sends to the page. */
let keyboardShortcutsListener: (() => void) | null = null
ipcRenderer.on('keyboard-shortcuts', () => {
  keyboardShortcutsListener?.()
})

/**
 * The whole of what the page may ask for: one argument each, checked by the main process.
 *
 * `openExternal` exists because the window-open handler refuses everything, so the app needs a way
 * to say "this one, and I meant it" that a `target="_blank"` in content we did not write cannot
 * reach. `copyText` exists because every permission is refused, the clipboard's included.
 * `setLocale` is for what main draws itself, the right-click menu. `restart` and `quit` are the
 * only ways the page can end its own process.
 */
contextBridge.exposeInMainWorld('sessionDesktop', {
  openExternal: (url: string) => {
    ipcRenderer.send('open-external', url)
  },
  /**
   * Where a file should go, and showing somebody where it went.
   *
   * `invoke` rather than `send` because both answer: the chosen path, and whether main revealed
   * it or refused.
   */
  chooseExportLocation: (suggestedName: string): Promise<string | null> =>
    ipcRenderer.invoke('files:choose-export-location', suggestedName),
  revealInFolder: (path: string): Promise<boolean> => ipcRenderer.invoke('files:reveal', path),
  /** The text to encode, never bytes: main draws the picture, so the page cannot write a file. */
  saveQrCode: (value: string, mark: QrMark | null): Promise<boolean> =>
    ipcRenderer.invoke('files:save-qr-code', value, mark),
  /**
   * Where a picked or dropped file lives, which the page cannot learn by itself: `File.path` is
   * gone from Electron. Empty for anything not on disk.
   */
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
  /**
   * The url of a picked or dropped file's staged thumbnail, or null. Takes the `File` rather than
   * a path, so the page can only ever preview a file the person chose.
   */
  allowPreview: (file: File): Promise<string | null> =>
    ipcRenderer.invoke('files:allow-preview', webUtils.getPathForFile(file)),
  /** Takes back a url `allowPreview` gave, once the composer lets go of the file. */
  revokePreview: (url: string): Promise<void> => ipcRenderer.invoke('files:revoke-preview', url),
  copyText: (text: string): Promise<void> => ipcRenderer.invoke('clipboard-write-text', text),
  /**
   * Lets the page send a picked or dropped file; main refuses a send that names any other. Takes
   * the `File`, as `allowPreview` does, so the page cannot name a path itself.
   */
  allowSend: (file: File): Promise<boolean> =>
    ipcRenderer.invoke('files:allow-send', webUtils.getPathForFile(file)),
  /** Gives back what `allowSend` granted, once the composer lets go of the file. */
  releaseSend: (path: string): Promise<void> => ipcRenderer.invoke('files:release-send', path),
  setLocale: (locale: string) => {
    ipcRenderer.send('locale', locale)
  },
  restart: () => {
    ipcRenderer.send('restart')
  },
  quit: () => {
    ipcRenderer.send('quit')
  },
  /** The content zoom from the View menu: the current one at once, then each change. */
  onZoom: (listener: (zoom: number) => void) => {
    zoomListener = listener
    listener(zoom)
  },
  /**
   * The log: one call to learn main's clock, and one to hand over lines as records, which main
   * sweeps and writes. Main owns the files and the pseudonym key; the page only ever appends.
   */
  openLog: (): Promise<unknown> => ipcRenderer.invoke('log:open'),
  appendLog: (records: unknown[]) => {
    ipcRenderer.send('log:append', records)
  },
  /** The export's four calls; main asks where to save, so no path ever comes back here. */
  retainedLogs: (): Promise<unknown> => ipcRenderer.invoke('log:retained'),
  logSpan: (first: string, last: string): Promise<unknown> =>
    ipcRenderer.invoke('log:span', first, last),
  exportLogs: (name: string, parts: unknown): Promise<boolean> =>
    ipcRenderer.invoke('log:export', name, parts),
  diagnostics: (): Promise<unknown> => ipcRenderer.invoke('log:diagnostics'),
  /** Which operating system, for naming the keys as its keyboards print them. */
  platform: process.platform,
  /** The Help menu's Keyboard Shortcuts, until the returned function is called. */
  onKeyboardShortcuts: (listener: () => void) => {
    keyboardShortcutsListener = listener
    return () => {
      if (keyboardShortcutsListener === listener) keyboardShortcutsListener = null
    }
  },
  /**
   * Notifications, posted by main where the OS draws them: the words already written. Main keeps
   * each by its id, so a later removal can take it down, and says where a click on one leads.
   */
  postNotification: (request: unknown) => {
    ipcRenderer.send('notifications:post', request)
  },
  removeNotifications: (ids: readonly string[]) => {
    ipcRenderer.send('notifications:remove', ids)
  },
  setBadgeCount: (count: number) => {
    ipcRenderer.send('notifications:badge', count)
  },
  onNotificationTap: (listener: (tap: unknown) => void) => {
    notificationTapListener = listener
    return () => {
      if (notificationTapListener === listener) notificationTapListener = null
    }
  },
  /** The flag overrides main read at launch; see `launchOverrides.ts`. */
  launchOverrides: readLaunchOverrides(process.argv),
})
