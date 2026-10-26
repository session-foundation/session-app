import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { MAX_SUGGESTED_NAME_CHARS } from '@session/app/exportFileName'
import type { Frame, Request } from '@session/client'

import {
  dialogDefaultPath,
  ExportGate,
  MAX_PATH_CHARS,
  readLastFolder,
  sanitiseSuggestedName,
  writeLastFolder,
} from '#src/main/files'

function exportTo(destination: string, id = 1, replace = false): Request {
  return {
    id,
    command: {
      type: 'exportAttachment',
      messageId: 7,
      index: 0,
      destination,
      notifySender: false,
      replace,
    },
  }
}

function landed(id: number, path: string): Frame {
  return { type: 'response', response: { id, result: { type: 'path', path } } }
}

/**
 * What the renderer is allowed to have written, and shown.
 *
 * `save_attachment` writes wherever it is told and `showItemInFolder` acts on any path, and the
 * page is not trusted to have checked either - the same standard `open-external` holds itself to.
 */
describe('an export the page asks for', () => {
  const chosen = '/home/someone/Documents/itinerary.pdf'

  it('goes to the exact path a save dialog returned', () => {
    const gate = new ExportGate(false)
    gate.grant(chosen, false)
    expect(gate.admit(exportTo(chosen))).toEqual(exportTo(chosen))
  })

  it('is refused before anything has been chosen', () => {
    const gate = new ExportGate(false)
    expect(typeof gate.admit(exportTo(chosen))).toBe('string')
    expect(typeof gate.admit(exportTo('/etc/passwd'))).toBe('string')
  })

  it('is refused under another name in the folder that was chosen', () => {
    // A folder rule would let this through: one answer would be a licence for any name there.
    const gate = new ExportGate(false)
    gate.grant(chosen, false)
    expect(typeof gate.admit(exportTo('/home/someone/Documents/.bashrc'))).toBe('string')
    expect(typeof gate.admit(exportTo('/home/someone/Documents/../.ssh/authorized_keys'))).toBe(
      'string',
    )
  })

  it('spends its grant: a second export to the same path is refused', () => {
    const gate = new ExportGate(false)
    gate.grant(chosen, false)
    expect(typeof gate.admit(exportTo(chosen, 1))).not.toBe('string')
    expect(typeof gate.admit(exportTo(chosen, 2))).toBe('string')
  })

  it('overwrites only where the dialog was answered over an existing file', () => {
    // The page's own `replace` is ignored either way: it is the dialog's question, not the page's.
    const fresh = new ExportGate(false)
    fresh.grant(chosen, false)
    expect(fresh.admit(exportTo(chosen, 1, true))).toEqual(exportTo(chosen, 1, false))

    const existing = new ExportGate(false)
    existing.grant(chosen, true)
    expect(existing.admit(exportTo(chosen, 1, false))).toEqual(exportTo(chosen, 1, true))
  })

  it('is resolved and compared by case only where paths are case-insensitive', () => {
    const insensitive = new ExportGate(true)
    insensitive.grant(chosen, false)
    expect(typeof insensitive.admit(exportTo('/home/someone/documents/ITINERARY.pdf'))).not.toBe(
      'string',
    )

    const sensitive = new ExportGate(false)
    sensitive.grant(chosen, false)
    expect(typeof sensitive.admit(exportTo('/home/someone/documents/itinerary.pdf'))).toBe('string')
    sensitive.grant(chosen, false)
    expect(
      typeof sensitive.admit(exportTo('/home/someone/Documents/../Documents/itinerary.pdf')),
    ).not.toBe('string')
  })

  it('follows a symlink to compare by the real folder, not by name', () => {
    const root = mkdtempSync(join(tmpdir(), 'session-app-files-test-'))
    const real = join(root, 'real')
    mkdirSync(real)
    const alias = join(root, 'alias')
    symlinkSync(real, alias)

    const gate = new ExportGate(false)
    gate.grant(join(alias, 'x.pdf'), false)
    expect(typeof gate.admit(exportTo(join(real, 'x.pdf')))).not.toBe('string')
  })

  it('is refused when it is longer than any real path', () => {
    const folder = '/home/someone/Documents/'
    const longest = folder + 'x'.repeat(MAX_PATH_CHARS - folder.length)
    const gate = new ExportGate(false)
    gate.grant(longest, false)
    gate.grant(longest + 'x', false)
    expect(typeof gate.admit(exportTo(longest, 1))).not.toBe('string')
    expect(typeof gate.admit(exportTo(longest + 'x', 2))).toBe('string')
  })

  it('passes every other command through untouched', () => {
    const gate = new ExportGate(false)
    const other: Request = { id: 3, command: { type: 'getAccountInfo' } }
    expect(gate.admit(other)).toBe(other)
  })
})

describe('a path the page asks to reveal', () => {
  const chosen = '/home/someone/Documents/itinerary.pdf'

  it('is allowed where an admitted export reported landing, collision name included', () => {
    const gate = new ExportGate(false)
    gate.grant(chosen, false)
    gate.admit(exportTo(chosen, 5))
    gate.observe(landed(5, '/home/someone/Documents/itinerary (1).pdf'))
    expect(gate.mayReveal('/home/someone/Documents/itinerary (1).pdf')).toBe(true)
  })

  it('is refused anywhere else, the chosen folder and its parent included', () => {
    const gate = new ExportGate(false)
    gate.grant(chosen, false)
    gate.admit(exportTo(chosen, 5))
    gate.observe(landed(5, chosen))
    expect(gate.mayReveal('/home/someone/Documents/..')).toBe(false)
    expect(gate.mayReveal('/home/someone/Documents/other.pdf')).toBe(false)
    expect(gate.mayReveal('/etc/passwd')).toBe(false)
  })

  it('is refused for a path answered to a request the gate did not admit', () => {
    const gate = new ExportGate(false)
    gate.observe(landed(9, '/home/someone/.ssh/id_ed25519'))
    expect(gate.mayReveal('/home/someone/.ssh/id_ed25519')).toBe(false)
  })

  it('is refused when it is not a path at all', () => {
    const gate = new ExportGate(false)
    for (const nonsense of ['', null, undefined, 42, {}]) {
      expect(gate.mayReveal(nonsense)).toBe(false)
    }
  })
})

describe('the name a save dialog is pre-filled with', () => {
  it('keeps an ordinary name as it is', () => {
    expect(sanitiseSuggestedName('itinerary (final).pdf')).toBe('itinerary (final).pdf')
  })

  it('is the bare name, as every platform starts from', () => {
    expect(sanitiseSuggestedName('../../.ssh/authorized_keys')).toBe('authorized_keys')
    expect(sanitiseSuggestedName('invoice\u202efdp.exe')).toBe('invoicefdp.exe')
  })

  it('falls back rather than trimming a name longer than a filesystem allows', () => {
    const longest = 'x'.repeat(MAX_SUGGESTED_NAME_CHARS)
    expect(sanitiseSuggestedName(longest)).toBe(longest)
    expect(sanitiseSuggestedName(longest + 'x')).toBe('attachment')
  })

  it('falls back when nothing usable is left', () => {
    for (const nothing of ['', '   ', '.', '..', '../..', 'folder/', '\u0000\u0001', null, 42]) {
      expect(sanitiseSuggestedName(nothing)).toBe('attachment')
    }
  })
})

describe('where a save dialog opens', () => {
  it('leaves the folder to macOS and Windows, which remember it themselves', () => {
    expect(dialogDefaultPath('a.jpg', 'darwin', '/last', '/downloads')).toBe('a.jpg')
    expect(dialogDefaultPath('a.jpg', 'win32', '/last', '/downloads')).toBe('a.jpg')
  })

  it('opens on Linux where the last export went, else in Downloads', () => {
    expect(dialogDefaultPath('a.jpg', 'linux', '/last', '/downloads')).toBe(join('/last', 'a.jpg'))
    expect(dialogDefaultPath('a.jpg', 'linux', undefined, '/downloads')).toBe(
      join('/downloads', 'a.jpg'),
    )
  })

  it('remembers the last folder across runs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'last-folder-'))
    const file = join(dir, 'last-export-folder')
    expect(readLastFolder(file)).toBeUndefined()
    writeLastFolder(file, dir)
    expect(readLastFolder(file)).toBe(dir)
  })

  it('forgets a folder that is gone, or is not a folder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'last-folder-'))
    const file = join(dir, 'last-export-folder')
    const gone = join(dir, 'gone')
    mkdirSync(gone)
    writeLastFolder(file, gone)
    rmSync(gone, { recursive: true })
    expect(readLastFolder(file)).toBeUndefined()

    writeLastFolder(file, file)
    expect(readLastFolder(file)).toBeUndefined()

    writeFileSync(file, '')
    expect(readLastFolder(file)).toBeUndefined()
  })
})
