import { mkdirSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { dirname, join } from 'node:path'

import { expect, test } from '@playwright/test'
import { ELEMENT } from '@session/test-ids'

import { CAPTURE_SCREEN, CAPTURE_WINDOW, windowFor, type WindowSize } from '#catalog/captureWindow'
import {
  catalogVerdict,
  filterPages,
  matchPages,
  parsePageFilter,
  shardCount,
  heaviestFirst,
  type CatalogPageSummary,
  type PageOutcome,
} from '#catalog/shards'
import { startXvfb, type Screen } from '#catalog/xvfb'

import { DesktopApp } from '../harness/DesktopApp'
import type { AuditIssue } from '../harness/ISessionApp'
import { describeIssues } from '../harness/knownIssues'

/** `pr` or `nightly`: see `catalogPages`. */
const TIER = process.env['CATALOG_TIER'] === 'nightly' ? 'nightly' : 'pr'
/** Where each page's PNG is written, for `argos upload`; nothing is written without it. */
const OUT = process.env['CATALOG_OUT']
/**
 * Where the ids of the pages this run draws are written as JSON before the first capture, so a
 * reader of `OUT` can tell a page that was never drawn from one the run did not reach. Kept out of
 * `OUT`, which is uploaded as it is.
 */
const PAGES_OUT = process.env['CATALOG_PAGES_OUT']
/** Only these pages: see `parsePageFilter`. A filtered run cannot tell a known issue is fixed. */
const PAGE_FILTER = parsePageFilter(process.env['CATALOG_PAGES'])
/**
 * Where the filter's names that match no page are written as JSON, rather than failing the run:
 * catalog:compare names pages that one of its two sides may not have.
 */
const UNMATCHED_OUT = process.env['CATALOG_PAGES_UNMATCHED_OUT']
const HIDDEN = process.env['SESSION_E2E_HIDDEN'] === '1'
/**
 * Windows stacked on one screen drew no faster together than one app alone, so on Linux each shard
 * gets an X server of its own. A hidden window is never mapped, so hidden shards share the run's
 * display; a shown one elsewhere has no screen of its own to go to, so it runs alone.
 */
const OWN_SCREENS = !HIDDEN && process.platform === 'linux'
/** How many apps capture at once, each its own share of the pages: see `shardCount`. */
const SHARDS =
  HIDDEN || OWN_SCREENS ? shardCount(process.env['CATALOG_SHARDS'], availableParallelism()) : 1

/** A message page waits for every picture in it to decode. */
const PAGE_READY_MS = 60_000

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
 * The desktop app on the catalog, in the capture window, with the catalog's pages listed; on
 * `display` where given, otherwise on the run's own.
 */
async function launchCatalog(display?: string): Promise<DesktopApp> {
  const app = await DesktopApp.launch('catalog', {
    env: {
      ...(display === undefined ? {} : { DISPLAY: display }),
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
  // The queue gives an app different pages, in a different order, on every run: dropping decodes
  // before each page keeps its pictures the same whichever pages that app drew first.
  await app.dropDecodedImages()
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
 * Captures and audits pages in one app until `next` has none left, `at` giving each page's place
 * in the tier. A page past the capture window is reported rather than thrown, so one tall story
 * does not blank the run.
 */
async function capturePages(
  app: DesktopApp,
  next: () => { page: CatalogPageSummary; at: number } | undefined,
): Promise<PageOutcome[]> {
  const outcomes: PageOutcome[] = []
  let windowSize = CAPTURE_WINDOW
  for (let item = next(); item !== undefined; item = next()) {
    const { page, at } = item
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
      outcomes.push({ at, tooTall: fits })
      continue
    }
    if (!sameSize(windowSize, fits)) {
      await sizeWindow(app, fits)
      windowSize = fits
    }
    const png = await app
      .locator(ELEMENT.catalog.page)
      .screenshot({ animations: 'disabled', caret: 'hide', scale: 'css' })
    if (OUT !== undefined) writeFileSync(join(OUT, `${id}.png`), png)
    const issues: AuditIssue[] = (await app.audit(ELEMENT.catalog.page)).map((issue) =>
      byRow(page, issue),
    )
    outcomes.push({ at, issues })
  }
  return outcomes
}

/**
 * Every catalog page of the tier, captured and audited: a page draws its story in each theme, and
 * the nightly tier in each accent too, so this is where colour contrast is checked.
 *
 * `SHARDS` apps capture at the same time, each in its own window and data directory, taking pages
 * from one queue. The verdict is taken once over every shard's findings: a known issue one shard
 * did not meet may be on another's page.
 */
test(`captures and audits the component catalog's ${TIER} pages @catalog`, async () => {
  test.setTimeout(30 * 60_000)
  // Everything started, in whatever order it came up, to be stopped however the run ends.
  const apps: DesktopApp[] = []
  const screens: Screen[] = []
  const launchShard = async () => {
    let display: string | undefined
    if (OWN_SCREENS) {
      const screen = await startXvfb(CAPTURE_SCREEN)
      screens.push(screen)
      display = screen.display
    }
    const app = await launchCatalog(display)
    apps.push(app)
    return app
  }
  try {
    const first = await launchCatalog()
    apps.push(first)
    const tierPages = await catalogPages(first, TIER)
    let pages: CatalogPageSummary[]
    if (UNMATCHED_OUT === undefined) pages = filterPages(tierPages, PAGE_FILTER)
    else {
      const matched = matchPages(tierPages, PAGE_FILTER)
      pages = matched.pages
      mkdirSync(dirname(UNMATCHED_OUT), { recursive: true })
      writeFileSync(UNMATCHED_OUT, JSON.stringify(matched.unmatched))
    }
    if (OUT !== undefined) mkdirSync(OUT, { recursive: true })
    if (PAGES_OUT !== undefined) {
      mkdirSync(dirname(PAGES_OUT), { recursive: true })
      writeFileSync(PAGES_OUT, JSON.stringify(pages.map((page) => page.id)))
    }

    const queue = heaviestFirst(pages.map((page, at) => ({ page, at, cells: page.cells })))
    const appCount = Math.max(1, Math.min(SHARDS, queue.length))
    const started = performance.now()
    // The first app starts on the queue while the others are still launching.
    const capture = async (app: Promise<DesktopApp>, index: number) => {
      let taken = 0
      let cells = 0
      const outcomes = await capturePages(await app, () => {
        const item = queue.shift()
        if (item !== undefined) {
          taken += 1
          cells += item.cells
        }
        return item
      })
      console.log(
        `shard ${String(index + 1)}/${String(appCount)}: ${String(taken)} pages, ` +
          `${String(cells)} cells, ${((performance.now() - started) / 1000).toFixed(0)}s`,
      )
      return outcomes
    }
    const settled = await Promise.allSettled([
      capture(Promise.resolve(first), 0),
      ...Array.from({ length: Math.max(0, appCount - 1) }, (_, at) =>
        capture(launchShard(), at + 1),
      ),
    ])
    // Every shard finishes its pages before a failure is raised, so the upload holds what it can.
    const failed = settled.find((result) => result.status === 'rejected')
    if (failed !== undefined) throw failed.reason
    const outcomes = settled.flatMap((result) =>
      result.status === 'fulfilled' ? result.value : [],
    )

    const { unknown, tooTall, fixed } = catalogVerdict(
      outcomes,
      TIER === 'nightly' && PAGE_FILTER === undefined,
    )
    expect.soft(tooTall, 'pages past the capture window, not captured').toEqual([])
    expect.soft(unknown, describeIssues(unknown).join('\n')).toEqual([])
    if (fixed !== null) expect.soft(fixed, 'no longer found: remove from KNOWN_ISSUES').toEqual([])
  } finally {
    await Promise.all(apps.map((app) => app.close()))
    await Promise.all(screens.map((screen) => screen.stop()))
  }
})
