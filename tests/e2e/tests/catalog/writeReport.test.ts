import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { encodePng, type Picture } from '#catalog/diff'
import { writeReport } from '#catalog/writeReport'

function solid(width: number, height: number, grey: number): Picture {
  const data = new Uint8Array(width * height * 4).fill(grey)
  for (let at = 3; at < data.length; at += 4) data[at] = 255
  return { width, height, data }
}

function captures(dir: string, pages: Record<string, Picture>): string {
  mkdirSync(dir, { recursive: true })
  for (const [id, picture] of Object.entries(pages))
    writeFileSync(join(dir, `${id}.png`), encodePng(picture))
  return dir
}

function seenKeys(html: string): Record<string, string | undefined> {
  const keys: Record<string, string> = {}
  for (const [, id = '', key = ''] of html.matchAll(/id="page-([^"]+)" data-seen-key="([^"]+)"/g))
    keys[id] = key
  return keys
}

describe('writing the report from two folders of captures', () => {
  const root = mkdtempSync(join(tmpdir(), 'catalog-report-'))
  const beforeDir = captures(join(root, 'before-pages'), {
    same: solid(40, 30, 255),
    darker: solid(40, 30, 255),
    taller: solid(40, 30, 128),
    gone: solid(40, 30, 0),
  })
  const afterDir = captures(join(root, 'after-pages'), {
    same: solid(40, 30, 255),
    darker: solid(40, 30, 0),
    // Not white: Argos takes the padding below the shorter side as white.
    taller: solid(40, 60, 128),
    new: solid(40, 30, 0),
  })
  const reportDir = join(root, 'report')
  const { results, file } = writeReport({
    beforeDir,
    afterDir,
    reportDir,
    base: { label: 'base', sha: 'a'.repeat(40) },
    head: { label: 'working tree', sha: 'b'.repeat(40) },
    tier: 'pr',
    sensitivity: 0.5,
    warnings: [],
  })

  it('classifies every page either side drew', () => {
    expect(results.map(({ id, status }) => `${id} ${status}`)).toEqual([
      'darker changed',
      'taller changed',
      'new added',
      'gone removed',
      'same unchanged',
    ])
    expect(results.find((result) => result.id === 'darker')?.differingPixels).toBe(1200)
  })

  it('compares only the pages it is limited to, either side', () => {
    const limited = writeReport({
      beforeDir,
      afterDir,
      reportDir: join(root, 'report-limited'),
      base: { label: 'base', sha: 'a'.repeat(40) },
      head: { label: 'working tree', sha: 'b'.repeat(40) },
      tier: 'pr',
      sensitivity: 0.5,
      only: new Set(['darker', 'new', 'gone']),
      warnings: [],
    })
    expect(limited.results.map(({ id, status }) => `${id} ${status}`)).toEqual([
      'darker changed',
      'new added',
      'gone removed',
    ])
  })

  it('puts each picture the report shows beside it, and a diff only for what changed', () => {
    const has = (path: string) => existsSync(join(reportDir, path))
    expect(['before/darker.png', 'after/darker.png', 'diff/darker.png'].every(has)).toBe(true)
    expect(has('diff/taller.png')).toBe(true)
    expect(has('after/new.png') && !has('before/new.png')).toBe(true)
    expect(has('before/gone.png') && !has('after/gone.png')).toBe(true)
    expect(has('diff/same.png')).toBe(false)
    expect(readFileSync(file, 'utf8')).toContain('src="diff/darker.png"')
  })

  it('keys a Seen mark on the pictures, so a redrawn page shows again', () => {
    const before = seenKeys(readFileSync(file, 'utf8'))
    // The same commits and count of differing pixels, as an uncommitted edit gives on a rerun.
    captures(afterDir, { new: solid(40, 30, 64), darker: solid(40, 30, 1) })
    const again = writeReport({
      beforeDir,
      afterDir,
      reportDir: join(root, 'report-again'),
      base: { label: 'base', sha: 'a'.repeat(40) },
      head: { label: 'working tree', sha: 'b'.repeat(40) },
      tier: 'pr',
      sensitivity: 0.5,
      warnings: [],
    })
    const after = seenKeys(readFileSync(again.file, 'utf8'))
    expect(again.results.find((result) => result.id === 'darker')?.differingPixels).toBe(1200)
    expect(after.new).not.toBe(before.new)
    expect(after.darker).not.toBe(before.darker)
    expect(after.taller).toBe(before.taller)
    expect(after.gone).toBe(before.gone)
  })
})
