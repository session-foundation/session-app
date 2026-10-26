import electron from 'electron'

const { contextBridge, ipcRenderer } = electron

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

/**
 * The whole of what the page may ask for: one argument each, checked by the main process.
 *
 * `openExternal` exists because the window-open handler refuses everything, so the app needs a way
 * to say "this one, and I meant it" that a `target="_blank"` in content we did not write cannot
 * reach. `copyText` exists because every permission is refused, the clipboard's included.
 * `setLocale` is for what main draws itself, the right-click menu. `restart` is the only way the
 * page can end its own process.
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
  copyText: (text: string): Promise<void> => ipcRenderer.invoke('clipboard-write-text', text),
  setLocale: (locale: string) => {
    ipcRenderer.send('locale', locale)
  },
  restart: () => {
    ipcRenderer.send('restart')
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
})
