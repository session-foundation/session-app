import { dirname } from 'node:path'

// Named imports do not survive the ESM loader here; see the note in index.ts.
import electron from 'electron'

const { BrowserWindow, dialog, ipcMain, shell } = electron

/**
 * Folders the person has pointed at in a save dialog this run.
 *
 * What makes `reveal` and `open` safe to expose at all. Both hand a path to the operating
 * system, and the renderer is not trusted to have checked one -- the same standard
 * `open-external` holds itself to. A path is allowed only if it sits in a folder somebody chose
 * here, which is the one way a folder gets into this set.
 *
 * By folder rather than by exact path because the path that comes back is not the path that went
 * out: a save that collides becomes `name (2)`, so an allowlist of the strings this handed over
 * would refuse exactly the file it had just written.
 *
 * Not persisted. A folder chosen last week is not something this run has any reason to reach.
 */
const chosen = new Set<string>()

/**
 * Whether a path sits in one of the folders somebody pointed at.
 *
 * Pure and exported so it can be tested without an Electron process: it is the whole of the rule
 * that decides what the renderer may hand to the operating system, and a rule that can only be
 * exercised by launching an app is one nobody exercises.
 */
export function isInChosenFolder(path: unknown, folders: ReadonlySet<string>): path is string {
  return typeof path === 'string' && path.length > 0 && folders.has(dirname(path))
}

/**
 * Choosing where a file goes, and showing somebody where it went.
 *
 * In main because that is where Electron's `dialog` and `shell` are, and because deciding what
 * the renderer may reach is not a decision the renderer can be trusted with.
 */
export function serveFiles(): void {
  ipcMain.handle('files:choose-save-location', async (event, suggested: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const name = typeof suggested === 'string' ? suggested : ''
    // Modal to the window that asked rather than to the app: a second window is not blocked by a
    // save dialog it did not open.
    const answer = await (window
      ? dialog.showSaveDialog(window, { defaultPath: name })
      : dialog.showSaveDialog({ defaultPath: name }))
    if (answer.canceled || answer.filePath === '') return null
    chosen.add(dirname(answer.filePath))
    return answer.filePath
  })

  ipcMain.handle('files:reveal', (_event, path: unknown) => {
    if (isInChosenFolder(path, chosen)) shell.showItemInFolder(path)
  })

  ipcMain.handle('files:open', async (_event, path: unknown) => {
    // `openPath` hands the file to whatever the OS has registered for it, which is the whole
    // point and also why the folder check above is not optional.
    if (isInChosenFolder(path, chosen)) await shell.openPath(path)
  })
}
