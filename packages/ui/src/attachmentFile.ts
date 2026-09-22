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

/**
 * Which glyph names a file's family.
 *
 * The extension is consulted before the declared type, which is the less authoritative source
 * first on purpose: `application/octet-stream` is what a great many senders declare, and
 * `text/csv` is a spreadsheet.
 */
export function fileGlyph(name: string, contentType?: string): IconName {
  const ext = parts(name).ext.slice(1).toLowerCase()
  const family = contentType?.slice(0, contentType.indexOf('/')).toLowerCase()
  return BY_EXTENSION[ext] ?? (family === undefined ? undefined : BY_FAMILY[family]) ?? 'file'
}

const BY_EXTENSION: Readonly<Record<string, IconName>> = {
  pdf: 'fileText',
  doc: 'fileText',
  docx: 'fileText',
  odt: 'fileText',
  pages: 'fileText',
  rtf: 'fileText',
  txt: 'fileText',
  md: 'fileText',
  csv: 'fileSpreadsheet',
  numbers: 'fileSpreadsheet',
  ods: 'fileSpreadsheet',
  xls: 'fileSpreadsheet',
  xlsx: 'fileSpreadsheet',
  '7z': 'fileArchive',
  bz2: 'fileArchive',
  gz: 'fileArchive',
  rar: 'fileArchive',
  tar: 'fileArchive',
  xz: 'fileArchive',
  zip: 'fileArchive',
  c: 'fileCode',
  css: 'fileCode',
  go: 'fileCode',
  h: 'fileCode',
  html: 'fileCode',
  js: 'fileCode',
  json: 'fileCode',
  py: 'fileCode',
  rs: 'fileCode',
  sh: 'fileCode',
  ts: 'fileCode',
  tsx: 'fileCode',
  xml: 'fileCode',
  yml: 'fileCode',
}

const BY_FAMILY: Readonly<Record<string, IconName>> = {
  audio: 'fileAudio',
  image: 'fileImage',
  text: 'fileText',
  video: 'fileVideo',
}
