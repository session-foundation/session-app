// Imported by desktop main and mobile: no platform APIs.

import { contentTypeEssence } from '@session/basic-types'

/**
 * The longest suggestion either app will make a name from; past it, both use their fallback.
 *
 * The file-name limit on ext4, APFS and NTFS. It also bounds the work spent on a name the sender
 * chose, however long they made it.
 */
export const MAX_SUGGESTED_NAME_CHARS = 255

/**
 * The bare file name in a sender's suggestion: no directory part, no control characters.
 *
 * Both separators are stripped whatever the platform, since the sender's platform is not this
 * one. This is the step the two apps share; what each does about length, a hidden name or
 * nothing left is its own policy, so the result may be empty, `.` or `..`.
 */
export function bareFileName(suggested: unknown): string {
  if (typeof suggested !== 'string') return ''
  return (
    suggested
      .slice(Math.max(suggested.lastIndexOf('/'), suggested.lastIndexOf('\\')) + 1)
      // C0, C1 and the bidi controls: `invoice\u202efdp.exe` would otherwise be shown, in a dialog
      // and in the file manager, as `invoiceexe.pdf`.
      // eslint-disable-next-line no-control-regex -- stripping control characters is the point
      .replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
      .trim()
  )
}

/** The extension each common declared type calls for, where its subtype is not one already. */
const TYPE_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/svg+xml': 'svg',
  'video/quicktime': 'mov',
  'video/3gpp': '3gp',
  'video/x-matroska': 'mkv',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/x-wav': 'wav',
  'audio/3gpp': '3gp',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'text/plain': 'txt',
}

/** A media subtype that can stand as its own extension, as `image/png`'s does. */
const PLAIN_MEDIA_TYPE = /^(?:image|video|audio)\/([a-z0-9]{2,5})$/

/** A dot that does not lead the name, then a short run with no dot or space. */
const HAS_EXTENSION = /.\.[^.\s]{1,16}$/

/** The extension a declared content type calls for, or null when it calls for no known one. */
function extensionForType(contentType: string | undefined): string | null {
  const essence = contentTypeEssence(contentType) ?? ''
  return TYPE_EXTENSIONS[essence] ?? PLAIN_MEDIA_TYPE.exec(essence)?.[1] ?? null
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0')
}

/** `Session_<yyyy-MM-dd-HHmmss>` in local time, and `_<n>` past the first attachment. */
function fallbackStem(sentAtMs: number, index: number): string {
  const at = new Date(sentAtMs)
  const day = `${String(at.getFullYear())}-${twoDigits(at.getMonth() + 1)}-${twoDigits(at.getDate())}`
  const time = `${twoDigits(at.getHours())}${twoDigits(at.getMinutes())}${twoDigits(at.getSeconds())}`
  return `Session_${day}-${time}${index > 0 ? `_${String(index + 1)}` : ''}`
}

interface ExportNameSource {
  filename?: string | undefined
  contentType?: string | undefined
  sentAtMs: number
  /** The attachment's position in its message. */
  index: number
}

/**
 * The name to suggest for an exported attachment: the sender's bare name, given the extension
 * its declared type calls for when it has none, or with no usable name one made from when the
 * message was sent, as legacy Android names one.
 *
 * Android's MediaStore stops numbering a taken name after 32 copies, so a name that recurs across
 * messages would come to fail every save; and it files by extension, so a sound with none would
 * land in Download.
 */
export function suggestedExportName({
  filename,
  contentType,
  sentAtMs,
  index,
}: ExportNameSource): string {
  const tooLong = typeof filename === 'string' && filename.length > MAX_SUGGESTED_NAME_CHARS
  const bare = tooLong ? '' : bareFileName(filename).replace(/^\.+/, '')
  const extension = extensionForType(contentType)
  const suffix = extension === null ? '' : `.${extension}`
  const named = HAS_EXTENSION.test(bare) ? bare : bare + suffix
  if (bare === '' || named.length > MAX_SUGGESTED_NAME_CHARS) {
    return fallbackStem(sentAtMs, index) + suffix
  }
  return named
}
