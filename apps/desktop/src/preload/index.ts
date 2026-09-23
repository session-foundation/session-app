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
 * Opening a link in the person's own browser.
 *
 * The whole of what the page may ask for, and deliberately one function with one argument: the
 * main process decides what a URL is allowed to be, and nothing here can widen that. It exists
 * because the window-open handler refuses everything, so the app needs a way to say "this one,
 * and I meant it" that a `target="_blank"` in content we did not write cannot reach.
 */
contextBridge.exposeInMainWorld('sessionDesktop', {
  openExternal: (url: string) => {
    ipcRenderer.send('open-external', url)
  },
  /**
   * Where a file should go, and showing somebody where it went.
   *
   * `invoke` rather than `send` for all three because the first has an answer and the other two
   * are worth awaiting: a reveal that failed and one that was refused look identical from here,
   * and main is the only side that knows which.
   */
  chooseSaveLocation: (suggestedName: string): Promise<string | null> =>
    ipcRenderer.invoke('files:choose-save-location', suggestedName),
  revealInFolder: (path: string): Promise<void> => ipcRenderer.invoke('files:reveal', path),
  openPath: (path: string): Promise<void> => ipcRenderer.invoke('files:open', path),
})
