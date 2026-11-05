import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { countByStatus, decodePng, hasDifferences, isBlank } from '#catalog/diff'
import {
  buildEnvironmentHash,
  cacheable,
  captureKey,
  EXIT,
  missingPages,
  parseCompareArgs,
  USAGE,
  UsageError,
  type CatalogTier,
  type CompareOptions,
} from '#catalog/options'
import {
  CompareFailure,
  Interrupted,
  mustStep,
  seconds,
  step,
  stopIfInterrupted,
  stopOnSignals,
  wasInterrupted,
} from '#catalog/steps'
import { pageIdsIn, writeReport } from '#catalog/writeReport'

/**
 * `pnpm catalog:compare`: the catalog Argos diffs on a pull request, captured at a base and in the
 * working tree on this machine, so whatever this machine draws differently from Argos's Linux
 * captures is drawn on both sides and cancels out. Each side runs its own spec, as each side's
 * build does in CI. Every launch is hidden: see apps/desktop/src/main/hiddenRun.ts.
 */

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))
const outRoot = join(repoRoot, 'test-results', 'catalog-compare')
const cacheRoot = join(outRoot, 'cache')
const uncachedRoot = join(outRoot, 'uncached')

/** The desktop main source that makes a hidden run; a base without it is given it. */
const HIDDEN_RUN_SOURCE = 'apps/desktop/src/main/hiddenRun.ts'
const DESKTOP_MAIN = 'apps/desktop/src/main'
const LOCALIZATION_SUBMODULE = 'packages/localization/src/localization-src'

/**
 * The longest a side's capture may take before Playwright stops it. The spec allows itself half an
 * hour, which a hidden window that never paints would spend waiting; a pr capture takes a minute
 * or two.
 */
const CAPTURE_LIMIT_MS: Record<CatalogTier, number> = { pr: 15 * 60_000, nightly: 60 * 60_000 }

/** Builds and captures share the machine with whoever is working on it. */
const NICE = ['nice', '-n', '10'] as const

/** Git's output as it printed it: a patch's last line can be a context line of one space. */
function gitRaw(args: readonly string[], cwd = repoRoot): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function git(args: readonly string[], cwd = repoRoot): string {
  return gitRaw(args, cwd).trim()
}

function gitSucceeds(args: readonly string[], cwd = repoRoot): boolean {
  try {
    git(args, cwd)
    return true
  } catch {
    return false
  }
}

/** What a capture directory holds beside its pictures. */
interface CaptureRecord {
  sha: string
  tier: CatalogTier
  /** Whether every page the spec listed was written; null where the spec lists none. */
  complete: boolean | null
  /** The spec's own verdict, which includes the axe audit. */
  specPassed: boolean
  overlay: boolean
}

interface Capture {
  dir: string
  record: CaptureRecord
  cached: boolean
}

const pagesDir = (capture: string) => join(capture, 'pages')

/** The harness that launches Electron, and the colour switch an older copy of it lacks. */
const HARNESS_SOURCE = 'tests/e2e/harness/DesktopApp.ts'
const SRGB_SWITCH = '--force-color-profile=srgb'
/** The launch argument an older harness has, which the switch is put after. */
const SRGB_ANCHOR = "'--disable-gpu',"

/** What a base is given so that it captures as the working tree does. */
interface BaseOverlay {
  /** Desktop main's change in the commit that added hidden runs, for a base from before it. */
  patch: string | null
  /**
   * Whether its harness needs the sRGB switch: pictures in two colour spaces differ wherever there
   * is colour, so a base without it would show every accent as changed.
   */
  srgb: boolean
  hash: string
}

/** Null when the base already captures as the working tree does. */
function baseOverlay(baseSha: string): BaseOverlay | null {
  let patch: string | null = null
  if (!gitSucceeds(['cat-file', '-e', `${baseSha}:${HIDDEN_RUN_SOURCE}`])) {
    const added = git([
      'log',
      '--diff-filter=A',
      '--format=%H',
      '-1',
      'HEAD',
      '--',
      HIDDEN_RUN_SOURCE,
    ])
    if (added === '')
      throw new CompareFailure(
        `${HIDDEN_RUN_SOURCE} is not in HEAD's history, so nothing can run hidden`,
      )
    patch = gitRaw(['diff', `${added}^`, added, '--', DESKTOP_MAIN])
  }
  const srgb = !gitRaw(['show', `${baseSha}:${HARNESS_SOURCE}`]).includes(SRGB_SWITCH)
  if (patch === null && !srgb) return null
  const hash = createHash('sha256')
    .update(patch ?? '')
    .update('\0')
    .update(srgb ? SRGB_SWITCH : '')
    .digest('hex')
    .slice(0, 12)
  return { patch, srgb, hash }
}

/** How the report says what the base was given. */
function overlayNote(overlay: BaseOverlay): string {
  const given = [
    ...(overlay.patch === null ? [] : ['the hidden-run change to desktop main']),
    ...(overlay.srgb ? ['the sRGB switch in its harness'] : []),
  ]
  return `given ${given.join(' and ')} to capture it`
}

/** Builds what the catalog spec launches, as the catalog workflow does, and captures it. */
async function buildAndCapture(
  checkout: string,
  dir: string,
  record: Omit<CaptureRecord, 'complete' | 'specPassed'>,
  label: string,
): Promise<CaptureRecord> {
  if (!existsSync(join(checkout, 'node_modules/electron/dist')))
    throw new CompareFailure(
      `${label}: Electron's binary is missing; run node node_modules/electron/install.js in ${checkout}`,
    )
  if (!existsSync(join(checkout, LOCALIZATION_SUBMODULE, 'README.md')))
    throw new CompareFailure(
      `${label}: the localization submodule is not checked out; git submodule update --init ${LOCALIZATION_SUBMODULE}`,
    )
  await mustStep(
    `${label}: build @session/localization`,
    [...NICE, 'pnpm', '--filter', '@session/localization', 'build'],
    { cwd: checkout },
  )
  await mustStep(
    `${label}: build @session/desktop`,
    [...NICE, 'pnpm', '--filter', '@session/desktop', 'build'],
    { cwd: checkout },
  )
  // The fake refuses to start without its photographs; a no-op once they are cached.
  await mustStep(`${label}: dev photographs`, ['pnpm', 'fake-media:fetch'], { cwd: checkout })

  rmSync(dir, { recursive: true, force: true })
  mkdirSync(pagesDir(dir), { recursive: true })
  const manifest = join(dir, 'pages.json')
  const code = await step(
    `${label}: capture the ${record.tier} catalog, hidden`,
    [
      ...NICE,
      'pnpm',
      'exec',
      'playwright',
      'test',
      '--project',
      'catalog',
      '--reporter=line',
      `--global-timeout=${String(CAPTURE_LIMIT_MS[record.tier])}`,
    ],
    {
      cwd: join(checkout, 'tests/e2e'),
      env: {
        ...process.env,
        CATALOG_TIER: record.tier,
        CATALOG_OUT: pagesDir(dir),
        CATALOG_PAGES_OUT: manifest,
        SESSION_E2E_HIDDEN: '1',
      },
    },
  )

  const captured = pageIdsIn(pagesDir(dir))
  if (captured.length === 0)
    throw new CompareFailure(`${label}: the catalog spec wrote no pages (exit ${String(code)})`)
  if (captured.every((id) => isBlank(decodePng(readFileSync(join(pagesDir(dir), `${id}.png`))))))
    throw new CompareFailure(
      `${label}: every page came out a single colour, which is a window that never painted: ` +
        'hidden capture is not drawing on this machine',
    )
  let complete: boolean | null = null
  if (existsSync(manifest)) {
    const missing = missingPages(JSON.parse(readFileSync(manifest, 'utf8')) as string[], captured)
    if (missing.length > 0)
      throw new CompareFailure(
        `${label}: the spec stopped before ${String(missing.length)} page(s), starting at ${missing[0] ?? ''}`,
      )
    complete = true
  }
  return { ...record, complete, specPassed: code === 0 }
}

/**
 * A capture of `sha`, from the cache when there is one. Written beside its final place and moved
 * there only once whole and sound (see `cacheable`), so the cache never holds half a capture or
 * one whose spec failed; such a capture is moved aside and used for this run alone.
 */
async function cachedCapture(
  key: string,
  options: CompareOptions,
  make: (dir: string) => Promise<CaptureRecord>,
): Promise<Capture> {
  const dir = join(cacheRoot, key)
  const recordFile = join(dir, 'capture.json')
  if (!options.refresh && existsSync(recordFile))
    return {
      dir,
      record: JSON.parse(readFileSync(recordFile, 'utf8')) as CaptureRecord,
      cached: true,
    }
  const partial = `${dir}.partial`
  let record: CaptureRecord
  try {
    record = await make(partial)
  } catch (error) {
    rmSync(partial, { recursive: true, force: true })
    throw error
  }
  writeFileSync(join(partial, 'capture.json'), JSON.stringify(record, null, 2))
  const destination = cacheable(record) ? dir : join(uncachedRoot, key)
  rmSync(destination, { recursive: true, force: true })
  mkdirSync(dirname(destination), { recursive: true })
  renameSync(partial, destination)
  return { dir: destination, record, cached: false }
}

/**
 * The base, checked out in a worktree under the output folder, installed from pnpm's store, built
 * and captured.
 *
 * **Inside the repository rather than in the temporary folder**, because pnpm uses its store only
 * from the same filesystem and otherwise makes a new one at that filesystem's root. Where the
 * temporary folder is a tmpfs, the default on several Linux distributions, the base's install
 * downloaded every package into memory. Beside the repository it links or clones from the store
 * the working tree was installed from.
 */
async function captureBase(
  sha: string,
  dir: string,
  overlay: BaseOverlay | null,
  options: CompareOptions,
): Promise<CaptureRecord> {
  const worktree = join(outRoot, `base-${sha.slice(0, 12)}`)
  git(['worktree', 'prune'])
  if (existsSync(worktree)) {
    if (!gitSucceeds(['worktree', 'remove', '--force', worktree]))
      rmSync(worktree, { recursive: true, force: true })
    git(['worktree', 'prune'])
  }
  console.log(`\n▶ base: worktree at ${worktree}`)
  git(['worktree', 'add', '--detach', worktree, sha])
  try {
    if (overlay?.patch != null) {
      console.log(`  base predates hidden runs: applying ${DESKTOP_MAIN}'s change from HEAD`)
      try {
        execFileSync('git', ['apply', '--3way'], {
          cwd: worktree,
          input: overlay.patch,
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      } catch (error) {
        const said = (error as { stderr?: Buffer }).stderr?.toString().trim() ?? ''
        throw new CompareFailure(
          `the base's ${DESKTOP_MAIN} does not take the hidden-run change, so it cannot be ` +
            `captured without a window; compare against a newer base. git apply said: ${said}`,
        )
      }
    }
    if (overlay?.srgb === true) {
      console.log(`  base predates sRGB captures: adding ${SRGB_SWITCH} to its harness`)
      const harness = join(worktree, HARNESS_SOURCE)
      const source = readFileSync(harness, 'utf8')
      if (!source.includes(SRGB_ANCHOR))
        throw new CompareFailure(
          `the base's ${HARNESS_SOURCE} has no ${SRGB_ANCHOR} to put ${SRGB_SWITCH} after, so ` +
            'its pictures would be in another colour space; compare against a newer base',
        )
      writeFileSync(harness, source.replace(SRGB_ANCHOR, `${SRGB_ANCHOR} '${SRGB_SWITCH}',`))
    }
    await mustStep(
      'base: localization submodule',
      [
        'git',
        '-c',
        'protocol.file.allow=always',
        'submodule',
        'update',
        '--init',
        '--reference',
        join(repoRoot, LOCALIZATION_SUBMODULE),
        LOCALIZATION_SUBMODULE,
      ],
      { cwd: worktree },
    )
    // Both builds read the repo's .env; the same one on both sides, or a flag set in it differs.
    // Its contents are in both sides' cache keys.
    if (existsSync(join(repoRoot, '.env')))
      copyFileSync(join(repoRoot, '.env'), join(worktree, '.env'))
    await mustStep(
      'base: install',
      [...NICE, 'pnpm', 'install', '--frozen-lockfile', '--prefer-offline'],
      { cwd: worktree },
    )
    await mustStep('base: Electron binary', ['node', 'node_modules/electron/install.js'], {
      cwd: worktree,
    })
    return await buildAndCapture(
      worktree,
      dir,
      { sha, tier: options.tier, overlay: overlay !== null },
      'base',
    )
  } finally {
    if (options.keepWorktree) console.log(`  kept ${worktree}`)
    else if (!gitSucceeds(['worktree', 'remove', '--force', worktree]))
      console.warn(`  could not remove ${worktree}: git worktree remove --force ${worktree}`)
  }
}

function captureNotes(side: string, record: CaptureRecord, cached: boolean): string[] {
  const notes: string[] = []
  if (!cacheable(record))
    notes.push(`The ${side} capture was not cached, so the next run captures it again.`)
  if (record.complete === null && !record.specPassed)
    notes.push(
      `The ${side} spec failed and lists no pages, so its capture cannot be confirmed whole: ` +
        'a page shown as added or removed may be one it did not reach.',
    )
  else if (!record.specPassed)
    notes.push(`The ${side} spec failed after capturing every page: its axe audit, most likely.`)
  if (cached) notes.push(`The ${side} capture is from the cache; --refresh captures it again.`)
  return notes
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE)
    return EXIT.same
  }
  const options = parseCompareArgs(argv)
  const started = Date.now()

  const baseRef = options.baseRef ?? 'origin/main'
  if (!gitSucceeds(['rev-parse', '--verify', `${baseRef}^{commit}`]))
    throw new CompareFailure(`${baseRef} is not a commit here; git fetch, or name another base`)
  const baseSha =
    options.baseRef === undefined
      ? git(['merge-base', 'HEAD', 'origin/main'])
      : git(['rev-parse', `${baseRef}^{commit}`])
  const baseLabel = options.baseRef ?? 'merge base with origin/main'
  const headSha = git(['rev-parse', 'HEAD'])
  const dirty = git(['status', '--porcelain', '--untracked-files=normal']) !== ''

  const overlay = baseOverlay(baseSha)
  const dotEnv = join(repoRoot, '.env')
  const host = {
    tier: options.tier,
    platform: process.platform,
    arch: process.arch,
    environmentHash: buildEnvironmentHash(
      existsSync(dotEnv) ? readFileSync(dotEnv, 'utf8') : null,
      process.env,
    ),
  }
  const base = await cachedCapture(
    captureKey({ sha: baseSha, ...host, overlayHash: overlay?.hash }),
    options,
    (dir) => captureBase(baseSha, dir, overlay, options),
  )
  stopIfInterrupted()

  const captureHead = (dir: string) =>
    buildAndCapture(
      repoRoot,
      dir,
      { sha: headSha, tier: options.tier, overlay: false },
      'working tree',
    )
  // Uncommitted changes are captured as they are, and never cached: no commit names them.
  const head: Capture = dirty
    ? await (async () => {
        const dir = join(outRoot, 'working-tree')
        return { dir, record: await captureHead(dir), cached: false }
      })()
    : await cachedCapture(captureKey({ sha: headSha, ...host }), options, captureHead)

  console.log('\n▶ compare')
  const { results, file } = writeReport({
    beforeDir: pagesDir(base.dir),
    afterDir: pagesDir(head.dir),
    reportDir: join(outRoot, 'report'),
    base: {
      label: baseLabel,
      sha: baseSha,
      note: overlay === null ? undefined : overlayNote(overlay),
    },
    head: {
      label: dirty ? 'working tree, with uncommitted changes' : 'working tree',
      sha: headSha,
    },
    tier: options.tier,
    sensitivity: options.sensitivity,
    warnings: [
      ...captureNotes('base', base.record, base.cached),
      ...captureNotes('working tree', head.record, head.cached),
    ],
  })

  const counts = countByStatus(results)
  console.log(
    `\ncatalog:compare: ${String(counts.changed)} changed, ${String(counts.added)} added, ` +
      `${String(counts.removed)} removed, ${String(counts.unchanged)} unchanged ` +
      `(${baseSha.slice(0, 10)} → working tree) in ${seconds(started)}\n${file}`,
  )
  return hasDifferences(results) ? EXIT.different : EXIT.same
}

stopOnSignals(EXIT.failed)

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    if (error instanceof UsageError) console.error(`${error.message}\n\n${USAGE}`)
    else if (error instanceof Interrupted || wasInterrupted())
      console.error('\ncatalog:compare stopped by an interrupt, before comparing')
    else
      console.error(
        `\ncatalog:compare failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    process.exit(EXIT.failed)
  },
)
