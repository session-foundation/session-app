import { createHash } from 'node:crypto'

import { ARGOS_SENSITIVITY } from '#catalog/diff'
import { parsePageFilter } from '#catalog/shards'

export const USAGE = `usage: pnpm catalog:compare [base-ref] [options]

Captures the component catalog at base-ref and in the working tree, on this machine, and writes
an HTML report of the pages that differ. base-ref defaults to the merge base with origin/main.

  --tier pr|nightly     which pages to capture (default pr, as a pull request's build)
  --pages <names>       only these pages, comma-separated: page ids, component.story or components;
                        a name only one side has shows its pages as added or removed
  --sensitivity <0-1>   Argos's threshold: 0 counts any pixel, 1 doubles every tolerance (default ${String(ARGOS_SENSITIVITY)})
  --refresh             capture again even where a capture of the same commit is cached
  --keep-worktree       leave the base's worktree, under test-results/catalog-compare/, in place

Exits 0 when nothing differs, 1 when something does, 2 when the comparison could not be made.`

export type CatalogTier = 'pr' | 'nightly'

export interface CompareOptions {
  /** Undefined: the merge base with origin/main. */
  baseRef: string | undefined
  tier: CatalogTier
  /** Undefined: every page of the tier. */
  pages: string[] | undefined
  sensitivity: number
  refresh: boolean
  keepWorktree: boolean
}

/** What the command can exit with; `different` lets it gate a script. */
export const EXIT = { same: 0, different: 1, failed: 2 } as const

/** A command line that cannot be acted on: the usage is the answer. */
export class UsageError extends Error {}

export function parseCompareArgs(argv: readonly string[]): CompareOptions {
  const options: CompareOptions = {
    baseRef: undefined,
    tier: 'pr',
    pages: undefined,
    sensitivity: ARGOS_SENSITIVITY,
    refresh: false,
    keepWorktree: false,
  }
  const args = [...argv]
  while (args.length > 0) {
    const arg = args.shift() ?? ''
    if (arg === '--') continue
    if (arg === '--refresh') options.refresh = true
    else if (arg === '--keep-worktree') options.keepWorktree = true
    else if (arg === '--tier') {
      const tier = args.shift()
      if (tier !== 'pr' && tier !== 'nightly') throw new UsageError('--tier takes pr or nightly')
      options.tier = tier
    } else if (arg === '--pages') {
      const pages = parsePageFilter(args.shift())
      if (pages === undefined) throw new UsageError('--pages takes comma-separated page names')
      options.pages = pages
    } else if (arg === '--sensitivity') {
      const value = Number(args.shift())
      if (!Number.isFinite(value) || value < 0 || value > 1)
        throw new UsageError('--sensitivity takes a number from 0 to 1')
      options.sensitivity = value
    } else if (arg.startsWith('-')) throw new UsageError(`unknown option ${arg}`)
    else if (options.baseRef === undefined) options.baseRef = arg
    else throw new UsageError(`one base ref only, not ${arg} as well`)
  }
  return options
}

/** The prefix of every variable the desktop build bakes in and its main process reads. */
const PUBLIC_PREFIX = 'EXPO_PUBLIC_'

/**
 * What a build takes from its environment, as a short hash: the repo-root `.env`, which the build
 * and desktop main both load (null when there is none, which hashes apart from an empty one), and
 * every `EXPO_PUBLIC_*` variable set, since the build bakes those in and flags read them.
 */
export function buildEnvironmentHash(dotEnv: string | null, env: NodeJS.ProcessEnv): string {
  const publicVariables = Object.entries(env)
    .filter(([name, value]) => name.startsWith(PUBLIC_PREFIX) && value !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return createHash('sha256')
    .update(JSON.stringify({ dotEnv, publicVariables }))
    .digest('hex')
    .slice(0, 12)
}

/**
 * Names a cached capture. A capture is only reused for the same commit, tier, host and build
 * environment, with the same change applied to make an older base run hidden, since each of those
 * changes a picture, and for the same pages.
 */
export function captureKey(capture: {
  sha: string
  tier: CatalogTier
  platform: string
  arch: string
  environmentHash: string
  overlayHash?: string | undefined
  pages?: readonly string[] | undefined
}): string {
  const overlay = capture.overlayHash === undefined ? '' : `-hidden-${capture.overlayHash}`
  const pages =
    capture.pages === undefined
      ? ''
      : `-pages-${createHash('sha256').update(capture.pages.join(',')).digest('hex').slice(0, 12)}`
  return (
    `${capture.sha}-${capture.tier}-${capture.platform}-${capture.arch}` +
    `-env-${capture.environmentHash}${overlay}${pages}`
  )
}

/**
 * Whether a capture may be cached. A cached capture is reused as whole and sound, so one whose spec
 * failed, or stopped before every page it listed, is used for this run only.
 */
export function cacheable(record: { specPassed: boolean; complete: boolean | null }): boolean {
  return record.specPassed && record.complete !== false
}

/** The pages the spec listed and never wrote, in its order. */
export function missingPages(expected: readonly string[], captured: Iterable<string>): string[] {
  const have = new Set(captured)
  return expected.filter((id) => !have.has(id))
}
