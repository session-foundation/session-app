import { createHash } from 'node:crypto'
import {
  copyFileSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, join } from 'node:path'

import {
  classifyPages,
  decodePng,
  diffPictures,
  encodePng,
  pngSize,
  type PageDiff,
  type PageResult,
} from '#catalog/diff'
import {
  imagePath,
  renderReport,
  type ImageKind,
  type ReportInput,
  type ReportPage,
} from '#catalog/report'

/** The page ids a folder of captures holds: one `<id>.png` each, as catalog.spec.ts writes them. */
export function pageIdsIn(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.png'))
    .map((name) => basename(name, '.png'))
}

/** A page's file in the report folder, where `imagePath` points the page at it. */
const reportFile = (reportDir: string, kind: ImageKind, id: string) =>
  join(reportDir, decodeURIComponent(imagePath(kind, id)))

/** A hard link where the file system allows one, since the captures are kept anyway. */
function place(from: string, to: string): void {
  try {
    linkSync(from, to)
  } catch {
    copyFileSync(from, to)
  }
}

/**
 * Compares two folders of captures and writes the report into `reportDir`, replacing whatever was
 * there: `index.html`, with each page's pictures in folders beside it.
 */
export function writeReport({
  beforeDir,
  afterDir,
  reportDir,
  sensitivity,
  ...report
}: {
  beforeDir: string
  afterDir: string
  reportDir: string
} & Omit<ReportInput, 'results'>): { results: PageResult[]; file: string } {
  rmSync(reportDir, { recursive: true, force: true })
  for (const kind of ['before', 'after', 'diff'] as const)
    mkdirSync(join(reportDir, kind), { recursive: true })
  const beforeFile = (id: string) => join(beforeDir, `${id}.png`)
  const afterFile = (id: string) => join(afterDir, `${id}.png`)

  const diffOf = (id: string): PageDiff => {
    const before = readFileSync(beforeFile(id))
    const after = readFileSync(afterFile(id))
    // Most pages are untouched by a change, and a byte-identical file needs no decoding.
    if (before.equals(after)) {
      const size = pngSize(after)
      return {
        status: 'unchanged',
        differingPixels: 0,
        totalPixels: size.width * size.height,
        before: size,
        after: size,
      }
    }
    const diff = diffPictures(decodePng(before), decodePng(after), sensitivity)
    if (diff.highlight !== undefined)
      writeFileSync(reportFile(reportDir, 'diff', id), encodePng(diff.highlight))
    return diff
  }

  const results = classifyPages(pageIdsIn(beforeDir), pageIdsIn(afterDir), diffOf).map(
    (result): ReportPage => {
      const { id, status } = result
      const hash = createHash('sha256').update(`${id}\0${status}\0`)
      if (status !== 'added') {
        place(beforeFile(id), reportFile(reportDir, 'before', id))
        hash.update(readFileSync(beforeFile(id))).update('\0')
      }
      if (status !== 'removed') {
        place(afterFile(id), reportFile(reportDir, 'after', id))
        hash.update(readFileSync(afterFile(id)))
      }
      return { ...result, pictures: hash.digest('hex').slice(0, 16) }
    },
  )
  const file = join(reportDir, 'index.html')
  writeFileSync(file, renderReport({ ...report, sensitivity, results }))
  return { results, file }
}
