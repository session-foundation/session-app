/**
 * **The only file in the mobile app that reaches the file system**, but for the dev builds'
 * `devMedia.ts`, which reads what `fake-media:push` copies into Documents. Every directory the app
 * writes into is one of the roots handed out here, which the native `storage-roots` module creates
 * under data protection class C and excludes from backup. A file written anywhere else --
 * Documents, which iCloud backs up -- would escape both, so dependency-cruiser and ESLint refuse
 * `expo-file-system` outside `src/storage/`. See docs/STORAGE.md.
 */
import type { NetworkName } from '@session/basic-types'
import { requireOptionalNativeModule } from 'expo'
import { Directory as ExpoDirectory, File as ExpoFile } from 'expo-file-system'

import {
  databaseFiles,
  fileUri,
  plainPath,
  libsessionPaths,
  ROOT_NAMES,
  rootIsProtected,
  storageRow,
  type RootReport,
  type RootState,
  type StorageRootPaths,
} from './layout'

export { FileMode } from 'expo-file-system'

/**
 * expo-file-system's move and copy, which the app reaches only through `moveInto`.
 *
 * Since iOS 26 a file moved or copied into a directory keeps the protection class of the directory
 * it was first written in, rather than taking its new one's. A file that started in the temporary
 * directory can arrive as `complete`, which a locked phone cannot open, so every move into a root
 * has to protect the file again where it lands. Leaving these out of the types below is what makes
 * that the only way to do it; a copy, when something needs one, gets a `copyInto` beside it.
 */
type Relocation = 'copy' | 'copySync' | 'move' | 'moveSync'

/** A file, without the moves and copies that would skip re-protecting it. */
export type File = Omit<ExpoFile, Relocation>

/** A directory, without its moves and copies, and listing files of the same kind. */
export type Directory = Omit<ExpoDirectory, Relocation | 'createFile' | 'list'> & {
  list(): (File | Directory)[]
}

// The same classes at run time; only what the app can call on them is narrowed.
export const File = ExpoFile as unknown as new (...uris: (string | File | Directory)[]) => File
const Directory = ExpoDirectory as unknown as new (
  ...uris: (string | File | Directory)[]
) => Directory

interface StorageRootsModule {
  readonly roots: StorageRootPaths
  /** Where the roots are, as the startup block says it. */
  readonly location: string
  /** Creates and protects every root; returns what failed. */
  ensure(): string[]
  /** Protects one file; false when there is nothing there. */
  protect(path: string): boolean
  /** Throws when there is nothing there. */
  inspect(path: string): RootState
}

/**
 * Every build carries the module. One without it is a dev client older than the module, which
 * would otherwise run with its data in Documents, unprotected and backed up -- so it stops here and
 * says to rebuild, rather than carrying a second layout to fall back on.
 */
const native = ((): StorageRootsModule => {
  const loaded = requireOptionalNativeModule<StorageRootsModule>('StorageRoots')
  if (loaded === null) {
    throw new Error(
      'the storage-roots native module is missing from this build; rebuild the dev client ' +
        '(pnpm ios / pnpm android) and reinstall it',
    )
  }
  return loaded
})()

const roots: StorageRootPaths = native.roots

/**
 * Moves a file into `destination`, a file or a directory in one of the roots, and protects it again
 * where it lands. See `Relocation` for why the move alone is not enough.
 */
export function moveInto(
  file: File,
  destination: File | Directory,
  options?: { overwrite?: boolean },
): File {
  ;(file as unknown as ExpoFile).moveSync(
    destination as unknown as ExpoFile | ExpoDirectory,
    options,
  )
  reprotect(file.uri)
  return file
}

/** Both attributes on one file. */
function reprotect(uri: string): void {
  native.protect(plainPath(uri))
}

/** One root, or a directory inside one, created if it is not there. */
function directory(path: string): Directory {
  const dir = new Directory(fileUri(path))
  dir.create({ intermediates: true, idempotent: true })
  return dir
}

/**
 * The log directory, not created here: the logs create it when they open, inside the handling that
 * sends their lines to the console when it cannot be.
 */
export const logsRoot: Directory = new Directory(fileUri(roots.logs))

/**
 * Where exports are staged for the share sheet, created if missing. A log export deletes only its
 * own top-level files here; an attachment's export, under `attachments/`, may still be in flight.
 */
export function exportsDirectory(): Directory {
  return directory(roots.exports)
}

/** A directory inside the exports root, created if missing. */
export function exportsSubdirectory(name: string): Directory {
  return directory(`${roots.exports}/${name}`)
}

/** Deletes a file or directory under the roots; one already gone is not an error. */
export function removeIfPresent(path: string): void {
  const target = new ExpoDirectory(fileUri(path))
  if (target.exists) target.delete()
  else {
    const file = new ExpoFile(fileUri(path))
    if (file.exists) file.delete()
  }
}

/** A folder somebody picks, outside the roots; null when they cancel. */
export async function pickDirectory(): Promise<Directory | null> {
  try {
    return await ExpoDirectory.pickDirectoryAsync()
  } catch {
    // The picker rejects on cancel, which is the one answer this has for "nothing chosen".
    return null
  }
}

/** Copies `file` out of the roots into a folder somebody picked, which is theirs to protect. */
export async function copyOut(file: File, folder: Directory): Promise<void> {
  await (file as unknown as ExpoFile).copy(folder as unknown as ExpoDirectory)
}

/**
 * One network's database files (the database, -wal, -shm) and attachment cache, as handles to read
 * sizes from. Nothing is created: a directory that is not there yet has no size to report.
 */
export function sessionFiles(network: NetworkName): {
  database: [File, File, File]
  attachments: Directory
} {
  const paths = libsessionPaths(roots.data, network)
  const [database, wal, shm] = databaseFiles(paths.dbPath).map((path) => new File(fileUri(path)))
  if (database === undefined || wal === undefined || shm === undefined) {
    throw new Error('databaseFiles names three files')
  }
  return { database: [database, wal, shm], attachments: new Directory(fileUri(paths.cacheDir)) }
}

/** Where libsession keeps one network's database and attachments, both created if missing. */
export function sessionPaths(network: NetworkName): { dbPath: string; cacheDir: string } {
  const paths = libsessionPaths(roots.data, network)
  directory(paths.cacheDir)
  return paths
}

/**
 * Protects the database and its -wal and -shm, once libsession has opened them; returns what
 * failed. SQLite creates them in place, so they would inherit the root's class -- but since iOS 26
 * a file can keep the class of wherever it was first written, and legacy re-applies both
 * attributes after every open for the same reason.
 */
export function protectDatabase(dbPath: string): string[] {
  const failures: string[] = []
  for (const path of databaseFiles(dbPath)) {
    try {
      native.protect(path)
    } catch (error) {
      failures.push(`${path}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return failures
}

/**
 * Each root as the file system reports it, for the startup block, and what needed doing about any
 * that were not protected. A root missing either attribute is re-protected at once rather than
 * left until the next launch.
 */
export function checkRoots(): { row: readonly [string, string]; warnings: string[] } {
  const reports = ROOT_NAMES.map((name): RootReport => {
    try {
      return [name, native.inspect(roots[name])]
    } catch (error) {
      return [name, error instanceof Error ? error.message : String(error)]
    }
  })
  const unprotected = reports.filter(
    ([, state]) => typeof state === 'string' || !rootIsProtected(state),
  )
  const warnings: string[] = []
  if (unprotected.length > 0) {
    warnings.push(
      `not protected, so protecting again: ${unprotected.map(([name]) => name).join(', ')}`,
    )
    warnings.push(...native.ensure().map((failure) => `could not protect ${failure}`))
  }
  return { row: ['Storage', storageRow(native.location, reports)], warnings }
}
