import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

import { bareFileName, MAX_SUGGESTED_NAME_CHARS } from '@session/app/exportFileName'
import { MAX_QR_TEXT_CHARS, qrCodePng } from '@session/app/qrCodePng'
import { isQrMark } from '@session/basic-types'
import type { Frame, OutgoingAttachment, Request } from '@session/client'

// Named imports do not survive the ESM loader here; see the note in index.ts.
import electron from 'electron'

import type { BrowserWindow } from 'electron'

import type { PreviewGrants } from './previewGrants'
import { isFromAppFrame } from './security'

const { app, dialog, shell } = electron

/** Linux's PATH_MAX. */
export const MAX_PATH_CHARS = 4096

// Resolved and, where it exists, symlink-followed, so a folder cannot read as contained by
// pointing somewhere else -- a folder not created yet has nothing to follow and compares as given.
function realFolder(folder: string): string {
  const resolved = resolve(folder)
  try {
    return realpathSync(resolved)
  } catch {
    return resolved
  }
}

// A file is its real folder plus its own name, since the file itself need not exist yet.
function resolvedPath(path: string): string {
  const full = resolve(path)
  return join(realFolder(dirname(full)), basename(full))
}

function pathKey(path: string, caseInsensitive: boolean): string {
  const resolved = resolvedPath(path)
  return caseInsensitive ? resolved.toLowerCase() : resolved
}

function isPath(path: unknown): path is string {
  return typeof path === 'string' && path !== '' && path.length <= MAX_PATH_CHARS
}

/**
 * What the renderer may write and reveal, decided by what a save dialog answered.
 *
 * `save_attachment` writes wherever a request's `destination` says, with no containment of its
 * own, and `showItemInFolder` acts on any path it is given, so the page -- not trusted, as
 * `open-external` is not -- is held to this:
 *
 * - **An export goes only to the exact path a dialog returned, once.** A grant is spent by the
 *   export it admits, so one answer cannot become a standing licence to write any name in that
 *   folder.
 * - **Whether it overwrites is main's to say**, from whether the file existed when the dialog
 *   returned: every platform's dialog asks before an existing name is chosen, so that is the
 *   answer the person gave. Whatever the request said is replaced.
 * - **A reveal is only of a path an export reported landing at**, which is where libsession put
 *   the file whatever it was asked for.
 *
 * One per window, and pure, so it can be tested without an Electron process. Neither persisted
 * nor shared: a path chosen last week, or in another window, is not one this has any reason to
 * reach.
 */
export class ExportGate {
  private readonly grants = new Map<string, { replace: boolean }>()
  private readonly exporting = new Set<number>()
  private readonly revealable = new Set<string>()

  constructor(private readonly caseInsensitive = process.platform === 'win32') {}

  /** Records a dialog's answer. `exists`: whether a file was already at that path. */
  grant(path: string, exists: boolean): void {
    this.grants.set(pathKey(path, this.caseInsensitive), { replace: exists })
  }

  /** The request to send on, or why it is refused. Only `exportAttachment` is ever changed. */
  admit(request: Request): Request | string {
    // Renderer input, so not necessarily a request at all; anything else goes on to be refused
    // by the bridge.
    const command = request.command as Request['command'] | undefined
    if (command?.type !== 'exportAttachment') return request
    if (!isPath(command.destination)) return 'exportAttachment.destination is not a path'
    const key = pathKey(command.destination, this.caseInsensitive)
    const granted = this.grants.get(key)
    if (granted === undefined) return 'exportAttachment.destination was not chosen in a save dialog'
    this.grants.delete(key)
    this.exporting.add(request.id)
    return { ...request, command: { ...command, replace: granted.replace } }
  }

  /** Watches the frames going back, for where an admitted export landed. */
  observe(frame: Frame): void {
    if (frame.type !== 'response' || !this.exporting.delete(frame.response.id)) return
    const result = frame.response.result
    if (result?.type === 'path') this.revealable.add(pathKey(result.path, this.caseInsensitive))
  }

  mayReveal(path: unknown): path is string {
    return isPath(path) && this.revealable.has(pathKey(path, this.caseInsensitive))
  }
}

/**
 * Which files the renderer may send, or ask the send plan of: only those the preload resolved from
 * a `File` the person picked or dropped in this window.
 *
 * libsession reads whatever path a send names, so without this a page script could send any file
 * this user can read to anyone, or learn from a plan whether any path exists and what it holds.
 *
 * Counted, since a path can be picked again while an earlier pick of it is still staged, and
 * released as the composer lets each pick go. `takeFile` never gets through: a desktop pick is the
 * person's own file, which libsession copies rather than moves.
 */
export class SendGate {
  private readonly picked = new Map<string, number>()

  constructor(private readonly caseInsensitive = process.platform === 'win32') {}

  grant(path: unknown): boolean {
    if (!isPath(path)) return false
    const key = pathKey(path, this.caseInsensitive)
    this.picked.set(key, (this.picked.get(key) ?? 0) + 1)
    return true
  }

  release(path: unknown): void {
    if (!isPath(path)) return
    const key = pathKey(path, this.caseInsensitive)
    const count = this.picked.get(key)
    if (count === undefined) return
    if (count > 1) this.picked.set(key, count - 1)
    else this.picked.delete(key)
  }

  /** Drops every grant, for a page that went without letting its picks go. */
  forgetAll(): void {
    this.picked.clear()
  }

  /**
   * The request to send on, or why it is refused. Each path goes on as the one its grant was
   * checked against, so libsession reads the file admitted rather than the page's spelling of it.
   */
  admit(request: Request): Request | string {
    const command = request.command as Request['command'] | undefined
    if (command?.type === 'attachmentSendPlan') {
      const { path } = command as { path: unknown }
      return isPath(path) && this.picked.has(pathKey(path, this.caseInsensitive))
        ? { ...request, command: { ...command, path: resolvedPath(path) } }
        : 'attachmentSendPlan.path names a file that was not picked'
    }
    if (command?.type !== 'sendMessage' || command.attachments === undefined) return request
    // Renderer input: the shape is checked here, and the field types by the bridge's converter.
    const named: unknown = command.attachments
    if (!Array.isArray(named)) return 'sendMessage.attachments is not a list'
    const attachments: OutgoingAttachment[] = []
    for (const attachment of named as unknown[]) {
      const { path, contentType, filename } = (attachment ?? {}) as Partial<OutgoingAttachment>
      if (!isPath(path) || !this.picked.has(pathKey(path, this.caseInsensitive)))
        return 'sendMessage.attachments names a file that was not picked'
      attachments.push({
        path: resolvedPath(path),
        ...(contentType === undefined ? {} : { contentType }),
        ...(filename === undefined ? {} : { filename }),
      })
    }
    return { ...request, command: { ...command, attachments } }
  }
}

/** What every request from one window passes through on its way to the bridge. */
export interface RequestGate {
  admit(request: Request): Request | string
  observe(frame: Frame): void
}

const FALLBACK_SUGGESTED_NAME = 'attachment'

/**
 * The file name to pre-fill a save dialog with, from a name the sender of the attachment chose.
 *
 * Only ever a bare name: a directory part, absolute or `..`, would pre-point the dialog at a
 * folder the sender picked, one Enter away from writing there.
 */
export function sanitiseSuggestedName(name: unknown): string {
  if (typeof name !== 'string' || name.length > MAX_SUGGESTED_NAME_CHARS) {
    return FALLBACK_SUGGESTED_NAME
  }
  const bare = bareFileName(name)
  return bare === '' || bare === '.' || bare === '..' ? FALLBACK_SUGGESTED_NAME : bare
}

/**
 * The folder a save dialog last answered, read back from `file`, or undefined if it is gone.
 *
 * Only ever a dialog's starting point, never a grant: `ExportGate` still admits nothing a dialog
 * did not return, so a tampered file can do no more than open the dialog somewhere odd.
 */
export function readLastFolder(file: string): string | undefined {
  try {
    const folder = readFileSync(file, 'utf8')
    return isPath(folder) && statSync(folder).isDirectory() ? folder : undefined
  } catch {
    return undefined
  }
}

/**
 * Records the folder a save dialog just answered, so the next dialog - in this run or a later
 * one - opens there. `readLastFolder` reads it back.
 *
 * The file holds the bare path, readable by this user only. Best effort: a failed write is
 * dropped rather than failing the export it follows.
 */
export function writeLastFolder(file: string, folder: string): void {
  try {
    writeFileSync(file, folder, { mode: 0o600 })
  } catch {
    // Losing it only costs the next dialog its starting folder.
  }
}

/**
 * macOS's and Windows's dialogs remember the last folder per app across runs when given a bare
 * name, so there the OS decides. Linux's (GTK, or the desktop portal) do not reliably, so there we
 * start from the folder we remembered.
 */
export function dialogDefaultPath(
  name: string,
  platform: NodeJS.Platform,
  lastFolder: string | undefined,
  downloads: string,
): string {
  if (platform === 'darwin' || platform === 'win32') return name
  return join(lastFolder ?? downloads, name)
}

/**
 * Choosing where a file goes, showing somebody where it went, and previewing and sending a file
 * picked to send, for one window. Returns the window's gate, which its bridge relay passes every
 * request through.
 *
 * In main because that is where Electron's `dialog` and `shell` are, and because deciding what
 * the renderer may reach is not a decision the renderer can be trusted with.
 */
export function serveFiles(
  window: BrowserWindow,
  appUrl: string,
  previews: PreviewGrants,
): RequestGate {
  const gate = new ExportGate()
  const sends = new SendGate()
  const lastFolderFile = join(app.getPath('userData'), 'last-export-folder')
  let lastFolder = readLastFolder(lastFolderFile)
  const { ipc } = window.webContents

  ipc.handle('files:choose-export-location', async (event, suggested: unknown) => {
    if (!isFromAppFrame(event.senderFrame, appUrl)) return null
    // Modal to this window rather than to the app: a second window is not blocked by a save
    // dialog it did not open.
    const answer = await dialog.showSaveDialog(window, {
      defaultPath: dialogDefaultPath(
        sanitiseSuggestedName(suggested),
        process.platform,
        lastFolder,
        app.getPath('downloads'),
      ),
      // macOS and Windows ask before an existing name is chosen; Linux asks only when told to, and
      // that question is what makes an overwrite the person's answer rather than a guess.
      properties: ['showOverwriteConfirmation', 'createDirectory'],
    })
    if (answer.canceled || answer.filePath === '') return null
    lastFolder = dirname(answer.filePath)
    writeLastFolder(lastFolderFile, lastFolder)
    gate.grant(answer.filePath, existsSync(answer.filePath))
    return answer.filePath
  })

  // Takes the text, never bytes: main draws the picture, so all the page can have written is a QR
  // code, and only where the person chose.
  ipc.handle(
    'files:save-qr-code',
    async (event, value: unknown, mark: unknown): Promise<boolean> => {
      if (!isFromAppFrame(event.senderFrame, appUrl)) return false
      if (typeof value !== 'string' || value.length === 0 || value.length > MAX_QR_TEXT_CHARS)
        return false
      if (mark !== null && !isQrMark(mark)) return false
      const answer = await dialog.showSaveDialog(window, {
        defaultPath: dialogDefaultPath(
          'session-qr-code.png',
          process.platform,
          lastFolder,
          app.getPath('downloads'),
        ),
        filters: [{ name: 'PNG', extensions: ['png'] }],
        properties: ['showOverwriteConfirmation', 'createDirectory'],
      })
      if (answer.canceled || answer.filePath === '') return false
      lastFolder = dirname(answer.filePath)
      writeLastFolder(lastFolderFile, lastFolder)
      writeFileSync(answer.filePath, qrCodePng(value, mark))
      return true
    },
  )

  // The path comes from the preload's `webUtils.getPathForFile`, never from the page.
  ipc.handle('files:allow-preview', (event, path: unknown): string | null => {
    if (!isFromAppFrame(event.senderFrame, appUrl)) return null
    return previews.grant(path)
  })

  // Only ever takes a grant away, so the page may name any url it likes.
  ipc.handle('files:revoke-preview', (event, url: unknown): void => {
    if (isFromAppFrame(event.senderFrame, appUrl)) previews.revoke(url)
  })

  ipc.handle('files:reveal', (event, path: unknown): boolean => {
    if (!isFromAppFrame(event.senderFrame, appUrl) || !gate.mayReveal(path)) return false
    shell.showItemInFolder(path)
    return true
  })

  // As for a preview, the path comes from the preload's `webUtils.getPathForFile`.
  ipc.handle('files:allow-send', (event, path: unknown): boolean => {
    if (!isFromAppFrame(event.senderFrame, appUrl)) return false
    return sends.grant(path)
  })

  // Only ever takes a grant away, so the page may name any path it likes.
  ipc.handle('files:release-send', (event, path: unknown): void => {
    if (isFromAppFrame(event.senderFrame, appUrl)) sends.release(path)
  })

  // A grant belongs to the page that picked the file, and a reloaded or crashed one releases none.
  window.webContents.on('did-navigate', () => {
    sends.forgetAll()
  })
  window.webContents.on('render-process-gone', () => {
    sends.forgetAll()
  })

  return {
    admit: (request) => {
      const exported = gate.admit(request)
      return typeof exported === 'string' ? exported : sends.admit(exported)
    },
    observe: (frame) => {
      gate.observe(frame)
    },
  }
}
