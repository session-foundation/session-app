import type { AuditIssue } from '../harness/ISessionApp'
import { auditVerdict, issueKey } from '../harness/knownIssues'

/** What the spec needs to know of a catalog page to place it and name its findings. */
export interface CatalogPageSummary {
  id: string
  /** `component.story`. */
  story: string
  rows: string[]
  /** `cellsOn`: the component renders it holds, which is what its capture and audit cost. */
  cells: number
}

/**
 * On a 24-core host, shards past eight saved a few seconds and past twelve none, while each holds
 * an X server and a window up to 3600x8000.
 */
export const MAX_SHARDS = 8

/**
 * `CATALOG_SHARDS` when set, else a shard per core, at most `MAX_SHARDS`: on a 4-core runner, four
 * shards capture in less than half the time of one, though the apps then share the cores.
 */
export function shardCount(override: string | undefined, cores: number): number {
  if (override !== undefined && override !== '') {
    const count = Number(override)
    if (!Number.isInteger(count) || count < 1)
      throw new Error(`CATALOG_SHARDS takes a whole number of shards, 1 or more, not ${override}`)
    return count
  }
  return Math.max(1, Math.min(MAX_SHARDS, cores))
}

/**
 * The pages heaviest first, ties in tier order: the order the apps take them from one shared
 * queue, so an app that draws faster takes more of them and all finish at nearly the same time.
 */
export function heaviestFirst<Page extends { cells: number }>(pages: readonly Page[]): Page[] {
  return pages
    .map((page, at) => ({ page, at }))
    .sort((a, b) => b.page.cells - a.page.cells || a.at - b.at)
    .map(({ page }) => page)
}

/** `CATALOG_PAGES`: comma-separated, each a page id, a `component.story` or a component. */
export function parsePageFilter(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined
  const names = value
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '')
  return names.length === 0 ? undefined : names
}

const matches = (page: CatalogPageSummary, name: string) =>
  page.id === name || page.story === name || page.story.split('.')[0] === name

/**
 * Whether a catalog spec's source reads `CATALOG_PAGES`; one that does not draws every page.
 * `CATALOG_PAGES_OUT` is a different variable, which specs read before the filter existed.
 */
export const readsPageFilter = (specSource: string) => /['"]CATALOG_PAGES['"]/.test(specSource)

/** The tier's pages the filter names, in tier order, and the names that matched none. */
export function matchPages(
  pages: readonly CatalogPageSummary[],
  filter: readonly string[] | undefined,
): { pages: CatalogPageSummary[]; unmatched: string[] } {
  if (filter === undefined) return { pages: [...pages], unmatched: [] }
  return {
    pages: pages.filter((page) => filter.some((name) => matches(page, name))),
    unmatched: filter.filter((name) => !pages.some((page) => matches(page, name))),
  }
}

/** `matchPages`, where a name that matches no page is an error. */
export function filterPages(
  pages: readonly CatalogPageSummary[],
  filter: readonly string[] | undefined,
): CatalogPageSummary[] {
  const matched = matchPages(pages, filter)
  if (matched.unmatched.length > 0)
    throw new Error(
      `CATALOG_PAGES names no page of this tier: ${matched.unmatched.join(', ')}; ` +
        'give a page id, a component.story or a component',
    )
  return matched.pages
}

/**
 * The names no capture matched, given each capture's unmatched names. A name only one side has is
 * a page the change adds or removes; one that no side has is a typo.
 */
export function unmatchedEverywhere(sides: readonly (readonly string[])[]): string[] {
  const [first = [], ...rest] = sides
  return first.filter((name) => rest.every((side) => side.includes(name)))
}

/** What drawing one page came to: its findings, or why it could not be captured. */
export type PageOutcome =
  { at: number; issues: readonly AuditIssue[] } | { at: number; tooTall: string }

/**
 * One verdict over every shard's pages, merged in tier order, so it reads as a single sweep's.
 * `sweep` is whether the run drew the whole nightly tier: only then can a known issue that no
 * shard found be called fixed, and `fixed` is null otherwise.
 */
export function catalogVerdict(outcomes: Iterable<PageOutcome>, sweep: boolean) {
  const found = new Map<string, AuditIssue>()
  const tooTall: string[] = []
  for (const outcome of [...outcomes].sort((a, b) => a.at - b.at)) {
    if ('tooTall' in outcome) tooTall.push(outcome.tooTall)
    else for (const issue of outcome.issues) found.set(issueKey(issue), issue)
  }
  const { unknown, fixed } = auditVerdict('catalog', found.values())
  return { unknown, tooTall, fixed: sweep && tooTall.length === 0 ? fixed : null }
}
