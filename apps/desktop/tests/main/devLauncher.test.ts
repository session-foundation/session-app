import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  applicationsDir,
  DEV_DESKTOP_NAME,
  devDesktopEntry,
  devLauncherSteps,
  writeDesktopEntry,
} from '#src/main/devLauncher'

const HOME = '/home/alice'

const PLAIN = { name: 'session-app', iconPath: '/src/apps/desktop/resources/icon.png' }

const DEV_SERVER = { ELECTRON_RENDERER_URL: 'http://localhost:5173' }

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'dev-launcher-'))
}

describe('the dev desktop name', () => {
  it("is never the shipped client's launcher, which Electron would derive from the package name", () => {
    expect(DEV_DESKTOP_NAME).not.toBe('session-desktop.desktop')
    expect(DEV_DESKTOP_NAME).toMatch(/\.desktop$/)
  })
})

describe('devLauncherSteps', () => {
  it('leaves a packaged build alone, whatever its environment says', () => {
    expect(devLauncherSteps({ packaged: true, platform: 'linux', env: DEV_SERVER })).toEqual({
      rename: false,
      writeLauncher: false,
    })
  })

  it('leaves macOS and Windows alone', () => {
    for (const platform of ['darwin', 'win32'] as const) {
      expect(devLauncherSteps({ packaged: false, platform, env: DEV_SERVER })).toEqual({
        rename: false,
        writeLauncher: false,
      })
    }
  })

  it('renames every unpackaged Linux run, and writes the launcher under the dev server only', () => {
    expect(devLauncherSteps({ packaged: false, platform: 'linux', env: DEV_SERVER })).toEqual({
      rename: true,
      writeLauncher: true,
    })
    expect(devLauncherSteps({ packaged: false, platform: 'linux', env: {} })).toEqual({
      rename: true,
      writeLauncher: false,
    })
  })
})

describe('applicationsDir', () => {
  it('defaults to ~/.local/share/applications', () => {
    expect(applicationsDir({ env: {}, home: HOME })).toBe('/home/alice/.local/share/applications')
  })

  it('follows an absolute XDG_DATA_HOME and ignores an empty or relative one', () => {
    expect(applicationsDir({ env: { XDG_DATA_HOME: '/data' }, home: HOME })).toBe(
      '/data/applications',
    )
    for (const XDG_DATA_HOME of ['', 'data']) {
      expect(applicationsDir({ env: { XDG_DATA_HOME }, home: HOME })).toBe(
        '/home/alice/.local/share/applications',
      )
    }
  })
})

describe('devDesktopEntry', () => {
  it('names the icon, starts nothing and stays out of the app list', () => {
    expect(devDesktopEntry(PLAIN)).toBe(
      [
        '[Desktop Entry]',
        'Type=Application',
        'Name=session-app (dev)',
        'Exec=false',
        'Icon=/src/apps/desktop/resources/icon.png',
        'NoDisplay=true',
        'SingleMainWindow=true',
        '',
      ].join('\n'),
    )
  })

  it('keeps a line break in a path from starting a key of its own', () => {
    const entry = devDesktopEntry({ ...PLAIN, iconPath: '/a\nExec=evil\\b' })
    expect(entry).toContain('Icon=/a\\nExec=evil\\\\b\n')
    expect(entry.split('\n').filter((line) => line.startsWith('Exec='))).toHaveLength(1)
  })
})

describe('writeDesktopEntry', () => {
  it('creates the directory and the launcher, leaving nothing half-written behind', async () => {
    const dir = join(scratch(), 'applications')
    expect(await writeDesktopEntry(dir, 'one')).toBeNull()
    expect(readFileSync(join(dir, DEV_DESKTOP_NAME), 'utf8')).toBe('one')
    expect(readdirSync(dir)).toEqual([DEV_DESKTOP_NAME])
  })

  it('leaves an identical launcher alone, so the shell is not made to reload it', async () => {
    const dir = scratch()
    const path = join(dir, DEV_DESKTOP_NAME)
    writeFileSync(path, 'same')
    const before = statSync(path)
    expect(await writeDesktopEntry(dir, 'same')).toBeNull()
    expect(statSync(path).ino).toBe(before.ino)
  })

  it('replaces one that is out of date', async () => {
    const dir = scratch()
    writeFileSync(join(dir, DEV_DESKTOP_NAME), 'old checkout')
    expect(await writeDesktopEntry(dir, 'this checkout')).toBeNull()
    expect(readFileSync(join(dir, DEV_DESKTOP_NAME), 'utf8')).toBe('this checkout')
  })

  it('reports a failure by its code, never by a message that names the home folder', async () => {
    const file = join(scratch(), 'not-a-directory')
    writeFileSync(file, '')
    const failure = await writeDesktopEntry(file, 'entry')
    expect(failure).toMatch(/^the dev launcher could not be written: E[A-Z]+$/)
    expect(failure).not.toContain(file)
  })
})
