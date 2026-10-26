import { bareFileName, MAX_SUGGESTED_NAME_CHARS } from '@session/app/exportFileName'
import { contentTypeEssence, utf8Encode } from '@session/basic-types'

/**
 * The rules that decide where an exported attachment may be written, with no expo in them.
 *
 * libsession's `save_attachment` writes wherever `destination` says and checks nothing, and the
 * name that goes into that path is the sender's. So everything here is about keeping a stranger's
 * filename from choosing the directory: a `../session.db` suggestion must land as a file called
 * `session.db` in a folder of its own, never on top of the database.
 */

const FALLBACK_NAME = 'attachment'

/** Well under the 255 bytes ext4, f2fs and APFS allow a name, leaving room for ` (1)`. */
const MAX_NAME_BYTES = 200

/**
 * Longer than any real extension; past it the last dot is part of the stem, which the cap may
 * cut.
 */
const MAX_EXTENSION_BYTES = 16

/**
 * What the photo library accepts, and the extension to give each.
 *
 * Narrower than the viewable list on purpose: neither Photos nor MediaStore takes WebM or Ogg,
 * and MediaStore files an asset by its extension, so a sender's `photo.exe` claiming to be JPEG
 * has to arrive as `photo.jpg` to be filed at all.
 */
const PHOTO_LIBRARY_TYPES: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/3gpp': '3gp',
}

/** MediaStore files these, and iOS Photos refuses them with PHPhotosErrorDomain 3302. */
const REFUSED_BY_IOS_PHOTOS: ReadonlySet<string> = new Set(['video/3gpp'])

/** The extension to file this under in the photo library, or null when it does not go there. */
export function photoLibraryExtension(contentType: string | undefined): string | null {
  const essence = contentTypeEssence(contentType)
  return (essence === undefined ? undefined : PHOTO_LIBRARY_TYPES[essence]) ?? null
}

/** Whether this platform's photo library takes the type. */
export function photoLibraryTakes(contentType: string | undefined, os: 'ios' | 'android'): boolean {
  if (photoLibraryExtension(contentType) === null) return false
  return os === 'android' || !REFUSED_BY_IOS_PHOTOS.has(contentTypeEssence(contentType) ?? '')
}

/**
 * Whether Android files this in a media collection rather than Downloads: what its photo library
 * takes, and any sound, as legacy Android does.
 */
export function isMediaStoreMedia(contentType: string | undefined): boolean {
  return (
    photoLibraryTakes(contentType, 'android') ||
    (contentTypeEssence(contentType)?.startsWith('audio/') ?? false)
  )
}

function fitsBytes(name: string): boolean {
  return utf8Encode(name).length <= MAX_NAME_BYTES
}

/** Shortens the stem, by code point, until the whole name fits; the extension survives. */
function capped(stem: string, extension: string): string {
  const suffix = extension === '' ? '' : `.${extension}`
  const points = Array.from(stem)
  while (points.length > 1 && !fitsBytes(points.join('') + suffix)) points.pop()
  return points.join('') + suffix
}

/**
 * A bare file name from the sender's suggestion: no directory part, no control characters, no
 * leading dots, bounded in length.
 *
 * A suggestion longer than `MAX_SUGGESTED_NAME_CHARS` is not shortened but replaced, as desktop
 * does; shortening one by code point is quadratic in its length, which the sender chooses.
 * A picture headed for the photo library gets the extension its declared type calls for.
 */
export function exportFileName(suggested: unknown, contentType?: string): string {
  const tooLong = typeof suggested === 'string' && suggested.length > MAX_SUGGESTED_NAME_CHARS
  // A leading dot hides the file, and MediaStore refuses a hidden name outright.
  const bare = tooLong ? '' : bareFileName(suggested).replace(/^\.+/, '')
  const name = bare === '' ? FALLBACK_NAME : bare

  const dot = name.lastIndexOf('.')
  const splits = dot > 0 && utf8Encode(name.slice(dot + 1)).length <= MAX_EXTENSION_BYTES
  const [stem, extension] = splits ? [name.slice(0, dot), name.slice(dot + 1)] : [name, '']
  const forced = photoLibraryExtension(contentType)
  return capped(stem, forced ?? extension)
}

/** Only the characters a staging token is made of, so a token can never be a path of its own. */
const TOKEN = /^[0-9a-f-]{8,64}$/i

/** Where one export is written before it is handed on: a folder of its own under `root`. */
export function stagedPath(root: string, token: string, name: string): string {
  if (!TOKEN.test(token)) throw new Error('not a staging token')
  return `${root}/${token}/${name}`
}

/**
 * The staging token a path was written under, or null when it is not one this run handed out.
 *
 * By folder rather than by the exact path handed out, because libsession answers a collision
 * with `name (1)`. The name part must still be a single plain segment, and the folder a token
 * that is still pending.
 */
export function stagingTokenOf(
  path: unknown,
  root: string,
  pending: { has(token: string): boolean },
): string | null {
  if (typeof path !== 'string' || !path.startsWith(`${root}/`)) return null
  const rest = path.slice(root.length + 1).split('/')
  if (rest.length !== 2) return null
  const [token, name] = rest as [string, string]
  if (!TOKEN.test(token) || !pending.has(token)) return null
  if (name === '' || name === '.' || name === '..' || name.includes('\\')) return null
  return token
}

/** More collisions than any folder holds of one name; past it the collision is the answer. */
const MAX_COLLISIONS = 1000

/** `name` for 0, then `name (1).ext`, `name (2).ext`... as libsession names a collision. */
export function numberedName(name: string, n: number): string {
  if (n === 0) return name
  const dot = name.lastIndexOf('.')
  const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
  return `${stem} (${String(n)})${extension}`
}

/**
 * The temporary name an export is written under before it is renamed into place: `.sessiondl`,
 * then `.sessiondl1`, `.sessiondl2`..., as libsession names its own.
 *
 * Never `.part`: somebody's own `report.pdf.part` from a browser is a plausible file to find next
 * to `report.pdf`, and one named after us is not. Numbered rather than replaced when taken.
 */
export function partName(name: string, n: number): string {
  return `${name}.sessiondl${n === 0 ? '' : String(n)}`
}

/**
 * Runs `place` under `nameFor(name, 0)`, then under each next one, until one lands.
 *
 * By attempting rather than by listing the folder first, so a name taken between the listing and
 * the write is still caught. `taken` says whether a failure was the name being in use; any other
 * failure, and the thousandth collision, propagate.
 */
export async function placeUnderFreeName(
  name: string,
  place: (candidate: string) => void | Promise<void>,
  taken: (error: unknown, candidate: string) => boolean,
  nameFor: (name: string, n: number) => string = numberedName,
): Promise<void> {
  for (let n = 0; ; n += 1) {
    const candidate = nameFor(name, n)
    try {
      await place(candidate)
      return
    } catch (error) {
      if (n >= MAX_COLLISIONS || !taken(error, candidate)) throw error
    }
  }
}

/**
 * The staging tokens this run handed out, and which of them has been written to.
 *
 * A token admits exactly one write, as desktop's gate spends a grant: it leaves `pending` when
 * the gate lets the request through and `written` when the port has delivered. Not persisted, so
 * a relaunch forgets every token and the sweep removes the folders.
 */
export class StagedExports<Delivery> {
  private readonly pending = new Map<string, Delivery>()
  private readonly written = new Map<string, Delivery>()

  constructor(private readonly root: string) {}

  stage(token: string, delivery: Delivery): void {
    this.pending.set(token, delivery)
  }

  /**
   * Spends the token `destination` was staged under: true once, false after and for anything
   * else.
   */
  admit(destination: unknown): boolean {
    const token = stagingTokenOf(destination, this.root, this.pending)
    const delivery = token === null ? undefined : this.pending.get(token)
    if (token === null || delivery === undefined) return false
    this.pending.delete(token)
    this.written.set(token, delivery)
    return true
  }

  /**
   * Takes the delivery an admitted write landed in; null unless `path` is in a folder one was
   * admitted to.
   */
  deliver(path: unknown): { token: string; delivery: Delivery } | null {
    const token = stagingTokenOf(path, this.root, this.written)
    const delivery = token === null ? undefined : this.written.get(token)
    if (token === null || delivery === undefined) return null
    this.written.delete(token)
    return { token, delivery }
  }
}
