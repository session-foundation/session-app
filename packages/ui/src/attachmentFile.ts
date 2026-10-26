import { contentTypeEssence } from '@session/basic-types'

import type { IconName } from './Icon.types'

/** A suffix longer than this is not an extension, whatever the last dot suggests. */
export const MAX_EXTENSION = 12

/**
 * How much of the stem the un-truncatable tail keeps.
 *
 * Enough to tell `report-2026-01` from `report-2026-02`, and no more: every character here is one
 * the head cannot spend, and the head is where the words are.
 */
const NAME_TAIL_KEEP = 5

/** How many characters of the extension the format label shows. */
const FORMAT_LENGTH = 4

function parts(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf('.')
  return dot > 0 && name.length - dot <= MAX_EXTENSION
    ? { stem: name.slice(0, dot), ext: name.slice(dot) }
    : { stem: name, ext: '' }
}

/** Hebrew, Arabic, Syriac, Thaana, N'Ko, Samaritan, Mandaic and their presentation forms. */
const RTL_LETTER = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/

/**
 * The direction a name reads in, from its first letter rather than the layout around it: a
 * filename is in whatever script its author wrote it, whatever language the app is in.
 */
export function nameDirection(name: string): 'ltr' | 'rtl' {
  const first = /\p{Letter}/u.exec(name)?.[0]
  return first !== undefined && RTL_LETTER.test(first) ? 'rtl' : 'ltr'
}

/**
 * A filename split into the part a layout may truncate and the part it may not.
 *
 * **No character budget.** A count cannot know how wide the row is, so a name shortened to a fixed
 * length is shortened again by the layout - which is how the extension goes missing from a name
 * that was cut short in order to keep it. Here the head ellipsises to whatever width is left and
 * the tail is structurally un-truncatable, so both ends survive at every width.
 */
export function splitFilename(name: string): { head: string; tail: string } {
  const { stem, ext } = parts(name)
  const keep = Math.min(stem.length, NAME_TAIL_KEEP)
  return {
    head: stem.slice(0, stem.length - keep),
    tail: stem.slice(stem.length - keep) + ext,
  }
}

/** The format, for the label under the glyph. Empty where the name does not say. */
export function fileFormat(name: string): string {
  return parts(name)
    .ext.slice(1, 1 + FORMAT_LENGTH)
    .toUpperCase()
}

const EXTENSIONS_BY_GLYPH: Partial<Record<IconName, readonly string[]>> = {
  fileText: ['pdf', 'doc', 'docx', 'odt', 'pages', 'rtf', 'txt', 'md'],
  fileSpreadsheet: ['csv', 'numbers', 'ods', 'xls', 'xlsx'],
  fileArchive: ['7z', 'bz2', 'gz', 'rar', 'tar', 'xz', 'zip'],
  fileCode: [
    'c',
    'css',
    'go',
    'h',
    'html',
    'js',
    'json',
    'py',
    'rs',
    'sh',
    'ts',
    'tsx',
    'xml',
    'yml',
  ],
}

const BY_EXTENSION: ReadonlyMap<string, IconName> = new Map(
  (Object.entries(EXTENSIONS_BY_GLYPH) as [IconName, readonly string[]][]).flatMap(
    ([glyph, extensions]) => extensions.map((extension) => [extension, glyph] as const),
  ),
)

const BY_FAMILY: Readonly<Record<string, IconName>> = {
  audio: 'fileAudio',
  image: 'fileImage',
  text: 'fileText',
  video: 'fileVideo',
}

/**
 * Which glyph names a file's family.
 *
 * The extension is consulted before the declared type, which is the less authoritative source
 * first on purpose: `application/octet-stream` is what a great many senders declare, and
 * `text/csv` is a spreadsheet.
 */
export function fileGlyph(name: string, contentType?: string): IconName {
  const ext = parts(name).ext.slice(1).toLowerCase()
  const family = contentTypeEssence(contentType)?.split('/')[0]
  return BY_EXTENSION.get(ext) ?? (family === undefined ? undefined : BY_FAMILY[family]) ?? 'file'
}
