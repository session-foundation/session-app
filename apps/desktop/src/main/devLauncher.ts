import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

// Named imports do not survive the ESM loader here; see the note in index.ts.
import electron from 'electron'

const { app } = electron

/**
 * What a Linux shell files an unpackaged run under: the launcher it looks for, and, without the
 * suffix, the window's Wayland app id and X11 class.
 *
 * Electron's default comes from the package name, `session-desktop`, which is the shipped client's
 * launcher: a dev window would be shown with that client's name and icon, and start it on a click.
 */
export const DEV_DESKTOP_NAME = 'session-app-dev.desktop'

/** `$XDG_DATA_HOME/applications`, the user's own launchers. The spec ignores a relative value. */
export function applicationsDir(input: {
  env: Readonly<Record<string, string | undefined>>
  home: string
}): string {
  const dataHome = input.env['XDG_DATA_HOME']
  const base =
    dataHome !== undefined && isAbsolute(dataHome) ? dataHome : join(input.home, '.local', 'share')
  return join(base, 'applications')
}

const STRING_ESCAPES: Readonly<Record<string, string>> = {
  '\\': '\\\\',
  '\n': '\\n',
  '\t': '\\t',
  '\r': '\\r',
}

/** A desktop-entry string value, in which a line break would start the next key. */
function stringValue(text: string): string {
  return text.replace(/[\\\n\t\r]/g, (char) => STRING_ESCAPES[char] ?? char)
}

/**
 * One `Exec` argument. The quoting escapes come first and the string escapes over them, which is
 * the order the spec reads them back in; `%%` keeps a `%` from reading as a field code.
 */
function execArgument(arg: string): string {
  return stringValue(`"${arg.replace(/["`$\\]/g, '\\$&')}"`).replace(/%/g, '%%')
}

/**
 * The launcher, which exists so the shell has an icon for the window and is never listed among
 * the apps. `Exec` is required: it starts this checkout's last build, not the dev server.
 */
export function devDesktopEntry(input: {
  name: string
  execPath: string
  appPath: string
  iconPath: string
}): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${stringValue(`${input.name} (dev)`)}`,
    `Exec=${execArgument(input.execPath)} ${execArgument(input.appPath)}`,
    `Icon=${stringValue(input.iconPath)}`,
    'NoDisplay=true',
    // Or GNOME offers "New Window", a second process on the same database.
    'SingleMainWindow=true',
    '',
  ].join('\n')
}

/**
 * Writes `entry` into `dir` unless it is already there. Renamed into place, because the shell
 * watches the directory and would read a half-written one. Resolves to why it could not, or null.
 */
export async function writeDesktopEntry(dir: string, entry: string): Promise<string | null> {
  const path = join(dir, DEV_DESKTOP_NAME)
  try {
    const current = await readFile(path, 'utf8').catch(() => null)
    if (current === entry) return null
    await mkdir(dir, { recursive: true })
    const written = `${path}.tmp`
    await writeFile(written, entry)
    await rename(written, path)
    return null
  } catch (error) {
    // The code and never the message, which names the home folder.
    const code = (error as NodeJS.ErrnoException).code ?? 'unknown'
    return `the dev launcher could not be written: ${code}`
  }
}

/**
 * Names an unpackaged Linux run, and under the dev server installs its launcher. **Before the app
 * is ready**, which is when a window first reads the desktop name.
 *
 * The launcher only under the dev server, which is the one sign of a developer at the machine:
 * e2e and CI runs load the built renderer and leave the home folder alone.
 */
export function installDevLauncher(iconPath: string): Promise<string | null> {
  if (app.isPackaged || process.platform !== 'linux') return Promise.resolve(null)
  app.setDesktopName(DEV_DESKTOP_NAME)
  if (process.env['ELECTRON_RENDERER_URL'] === undefined) return Promise.resolve(null)
  return writeDesktopEntry(
    applicationsDir({ env: process.env, home: app.getPath('home') }),
    devDesktopEntry({
      name: app.getName(),
      execPath: process.execPath,
      appPath: app.getAppPath(),
      iconPath,
    }),
  )
}
