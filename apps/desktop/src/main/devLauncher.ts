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

/**
 * Which parts of the dev identity a run takes on. Only an unpackaged Linux run is renamed, and
 * only one under the dev server writes the launcher: e2e and CI runs load the built renderer, and
 * a home folder on a runner is not ours to add to. A `pnpm start` run is renamed without one, so
 * it shows the icon only once a dev-server run has written it.
 */
export function devLauncherSteps(input: {
  packaged: boolean
  platform: NodeJS.Platform
  env: Readonly<Record<string, string | undefined>>
}): { rename: boolean; writeLauncher: boolean } {
  const rename = !input.packaged && input.platform === 'linux'
  return { rename, writeLauncher: rename && input.env['ELECTRON_RENDERER_URL'] !== undefined }
}

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
 * The launcher, which exists so the shell has an icon for the window and is never listed among
 * the apps. `Exec` is required, and `false` on purpose: a dev run needs the dev server and its
 * environment, which a click from the dash would start without.
 */
export function devDesktopEntry(input: { name: string; iconPath: string }): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${stringValue(`${input.name} (dev)`)}`,
    'Exec=false',
    `Icon=${stringValue(input.iconPath)}`,
    'NoDisplay=true',
    // Or GNOME offers a "New Window" that would run `Exec`.
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
 * Takes on the steps `devLauncherSteps` picks. **Before the app is ready**, which is when a window
 * first reads the desktop name.
 */
export function installDevLauncher(iconPath: string): Promise<string | null> {
  const steps = devLauncherSteps({
    packaged: app.isPackaged,
    platform: process.platform,
    env: process.env,
  })
  if (steps.rename) app.setDesktopName(DEV_DESKTOP_NAME)
  if (!steps.writeLauncher) return Promise.resolve(null)
  return writeDesktopEntry(
    applicationsDir({ env: process.env, home: app.getPath('home') }),
    devDesktopEntry({ name: app.getName(), iconPath }),
  )
}
