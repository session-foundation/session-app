import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { expect, test } from '@playwright/test'
import { ELEMENT } from '@session/test-ids'

import { CAPTURE_WINDOW, windowFor, type WindowSize } from '#catalog/captureWindow'

import { DesktopApp } from '../harness/DesktopApp'
import type { AuditIssue } from '../harness/ISessionApp'
import { auditVerdict, describeIssues, issueKey } from '../harness/knownIssues'

/** `pr` or `nightly`: see `catalogPages`. */
const TIER = process.env['CATALOG_TIER'] === 'nightly' ? 'nightly' : 'pr'
/** Where each page's PNG is written, for `argos upload`; nothing is written without it. */
const OUT = process.env['CATALOG_OUT']
/**
 * Where the tier's page ids are written as JSON before the first capture, so a reader of `OUT` can
 * tell a page that was never drawn from one the run did not reach. Kept out of `OUT`, which is
 * uploaded as it is.
 */
const PAGES_OUT = process.env['CATALOG_PAGES_OUT']

/** A message page waits for every picture in it to decode. */
const PAGE_READY_MS = 60_000

interface CatalogPageSummary {
  id: string
  story: string
  rows: string[]
}

interface CatalogGlobal {
  sessionCatalog?: { pages: (tier: string) => CatalogPageSummary[] }
  location: { hash: string }
}

/** How far the page reaches from the document's corner, which the window must cover. */
async function pageExtent(app: DesktopApp): Promise<WindowSize> {
  return app.locator(ELEMENT.catalog.page).evaluate((element) => {
    const { scrollX, scrollY } = globalThis as unknown as { scrollX: number; scrollY: number }
    const box = (
      element as unknown as { getBoundingClientRect(): { right: number; bottom: number } }
    ).getBoundingClientRect()
    return { width: box.right + scrollX, height: box.bottom + scrollY }
  })
}

/**
 * Sizes the window and waits until the page has laid out and painted in it. `resize` waits on the
 * width alone, and a page taller than the window grows only the height. A window manager or a
 * screen that refuses the size fails here, rather than as a capture black below the fold.
 */
async function sizeWindow(app: DesktopApp, size: WindowSize): Promise<void> {
  await app.resize(size.width, size.height)
  await app.page
    .waitForFunction(
      (wanted) => (globalThis as unknown as { innerHeight: number }).innerHeight === wanted.height,
      size,
      { timeout: 5_000 },
    )
    .catch(() => {
      throw new Error(
        `the window did not reach ${String(size.width)}x${String(size.height)}: the screen or ` +
          'window manager clamped it, so a capture would be cut off',
      )
    })
  await app.page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const scope = globalThis as unknown as { requestAnimationFrame(run: () => void): void }
        // One frame to lay out at the new size, one to paint it.
        scope.requestAnimationFrame(() => scope.requestAnimationFrame(() => resolve()))
      }),
  )
}

const sameSize = (a: WindowSize, b: WindowSize) => a.width === b.width && a.height === b.height

/**
 * A finding on a cell, named by its story and row rather than by its page, theme and state: the
 * same defect drawn in every theme is one finding, and its name survives a page being added.
 */
function byRow(page: CatalogPageSummary, issue: AuditIssue): AuditIssue {
  const cell = `catalog-cell-${page.id}-`
  if (!issue.target.startsWith(cell)) return issue
  const rest = issue.target.slice(cell.length)
  const row = page.rows
    .filter((name) => rest.startsWith(`${name}-`))
    .sort((a, b) => b.length - a.length)[0]
  return row === undefined ? issue : { ...issue, target: `${page.story} ${row}` }
}

/**
 * Leaves the pointer over the window's corner, the page's padding, where no story draws a control.
 * The capture under Xvfb still drew a row hovered with the window ignoring the pointer, so the page
 * is told the pointer is somewhere harmless before each picture.
 */
async function restPointer(app: DesktopApp): Promise<void> {
  await app.page.mouse.move(0, 0)
}

/** The desktop app on the catalog, in the capture window, with the catalog's pages listed. */
async function launchCatalog(): Promise<DesktopApp> {
  const app = await DesktopApp.launch('catalog', {
    env: {
      TZ: 'UTC',
      EXPO_PUBLIC_SESSION_FAKE_FIXTURE: 'showcase',
      EXPO_PUBLIC_SESSION_FLAG_COMPONENT_CATALOG: '1',
    },
  })
  // Which element the resting pointer leaves hovered depends on the pages drawn before.
  await app.ignorePointer()
  await sizeWindow(app, CAPTURE_WINDOW)
  await app.page.emulateMedia({ reducedMotion: 'reduce' })
  await app.page.waitForFunction(
    () => (globalThis as unknown as CatalogGlobal).sessionCatalog !== undefined,
  )
  return app
}

async function catalogPages(app: DesktopApp, tier: string): Promise<CatalogPageSummary[]> {
  return app.page.evaluate(
    (wanted) => (globalThis as unknown as CatalogGlobal).sessionCatalog?.pages(wanted) ?? [],
    tier,
  )
}

async function openPage(app: DesktopApp, tier: string, id: string): Promise<void> {
  await app.page.evaluate(
    (hash) => {
      ;(globalThis as unknown as CatalogGlobal).location.hash = hash
    },
    `#/catalog/${tier}/${encodeURIComponent(id)}`,
  )
  await expect(app.locator(ELEMENT.catalog.ready)).toHaveText(id, { timeout: PAGE_READY_MS })
}

/** The window the open page needs, or, naming the page, why no window holds it. */
async function windowForPage(app: DesktopApp, id: string): Promise<WindowSize | string> {
  try {
    return windowFor(await pageExtent(app))
  } catch (error) {
    // The size alone does not say which story to split.
    return `${id}: ${(error as Error).message}`
  }
}

/**
 * Every catalog page of the tier, captured and audited: a page draws its story in each theme, and
 * the nightly tier in each accent too, so this is where colour contrast is checked.
 */
test(`captures and audits the component catalog's ${TIER} pages @catalog`, async () => {
  test.setTimeout(30 * 60_000)
  const app = await launchCatalog()
  try {
    let windowSize = CAPTURE_WINDOW
    const pages = await catalogPages(app, TIER)
    if (OUT !== undefined) mkdirSync(OUT, { recursive: true })
    if (PAGES_OUT !== undefined) {
      mkdirSync(dirname(PAGES_OUT), { recursive: true })
      writeFileSync(PAGES_OUT, JSON.stringify(pages.map((page) => page.id)))
    }

    const found = new Map<string, AuditIssue>()
    // Reported once every other page is captured, so one tall story does not blank the whole run.
    const tooTall: string[] = []
    for (const page of pages) {
      const { id } = page
      // Every page is laid out in the same window whatever came before it, then the window grows to
      // hold it: a capture paints only what lies inside the window, and the rest comes out black.
      if (!sameSize(windowSize, CAPTURE_WINDOW)) {
        await sizeWindow(app, CAPTURE_WINDOW)
        windowSize = CAPTURE_WINDOW
      }
      await openPage(app, TIER, id)
      const fits = await windowForPage(app, id)
      if (typeof fits === 'string') {
        tooTall.push(fits)
        continue
      }
      if (!sameSize(windowSize, fits)) {
        await sizeWindow(app, fits)
        windowSize = fits
      }
      await restPointer(app)
      const png = await app
        .locator(ELEMENT.catalog.page)
        .screenshot({ animations: 'disabled', caret: 'hide', scale: 'css' })
      if (OUT !== undefined) writeFileSync(join(OUT, `${id}.png`), png)
      for (const issue of await app.audit(ELEMENT.catalog.page)) {
        const named = byRow(page, issue)
        found.set(issueKey(named), named)
      }
    }

    expect.soft(tooTall, 'pages past the capture window, not captured').toEqual([])
    const { unknown, fixed } = auditVerdict('catalog', found.values())
    expect.soft(unknown, describeIssues(unknown).join('\n')).toEqual([])
    // Only a nightly sweep that drew every page can tell a known issue is fixed.
    if (TIER === 'nightly' && tooTall.length === 0)
      expect.soft(fixed, 'no longer found: remove from KNOWN_ISSUES').toEqual([])
  } finally {
    await app.close()
  }
})
