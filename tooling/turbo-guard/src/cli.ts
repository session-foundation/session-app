import { execFileSync } from 'node:child_process'
import { globSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { CHECKS } from '@session/checks'

import { absentSubmodules, turboTasksIn } from '#src/ci'
import { pushedFiles } from '#src/files'
import { hookDrift } from '#src/hooks'
import { importViolations, type WorkspacePackage } from '#src/manifests'
import { check, type Task } from '#src/rules'
import { nativeWithoutTwin } from '#src/twins'

const repoRoot = join(import.meta.dirname, '../../..')
const WORKFLOW = '.github/workflows/ci.yml'

const workflow = readFileSync(join(repoRoot, WORKFLOW), 'utf8')
const scripts = (
  JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>
  }
).scripts
const absent = absentSubmodules(readFileSync(join(repoRoot, '.gitmodules'), 'utf8'), workflow)
const names = turboTasksIn(workflow, scripts)

interface DryTask {
  taskId: string
  directory: string
  command: string
  resolvedTaskDefinition: { cache: boolean; inputs: string[]; outputs: string[] }
}

// The run graph turbo would execute for CI's steps, dependencies included -- so a task only ever
// reached through `^build` is checked, and one no CI step reaches, like the native build, is not.
const dry = JSON.parse(
  execFileSync('pnpm', ['exec', 'turbo', 'run', ...names, '--dry=json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }),
) as { tasks: DryTask[] }

const tasks: Task[] = dry.tasks
  // A package with no script for the task still appears in the graph, and runs nothing.
  .filter((task) => task.command !== '<NONEXISTENT>')
  .map((task) => ({
    id: task.taskId,
    directory: task.directory,
    cache: task.resolvedTaskDefinition.cache,
    inputs: task.resolvedTaskDefinition.inputs,
    outputs: task.resolvedTaskDefinition.outputs,
  }))

const committed = pushedFiles(repoRoot)

const violations = check(tasks, {
  absent,
  committed: (glob) => globSync(glob, { cwd: repoRoot }).filter((path) => committed.has(path)),
})

interface Manifest {
  name?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

// Every manifest the push carries but the root's, which is the workspace rather than a package in
// it.
const manifests = [...committed]
  .filter((path) => path.endsWith('/package.json') && !path.includes('node_modules/'))
  .map((path) => ({
    directory: dirname(path),
    manifest: JSON.parse(readFileSync(join(repoRoot, path), 'utf8')) as Manifest,
  }))
  .filter(({ manifest }) => manifest.name !== undefined)

/** The package a file belongs to: the deepest manifest above it. */
function ownerOf(file: string): string | undefined {
  return manifests
    .map(({ directory }) => directory)
    .filter((directory) => file.startsWith(`${directory}/`))
    .sort((a, b) => b.length - a.length)[0]
}

const SOURCE = /\.(?:[cm]?[jt]sx?)$/

/**
 * This tool's own tests, left out of the import check: their fixtures are import statements
 * written as strings, which a text scan cannot tell from the real thing.
 */
const OWN_TESTS = 'tooling/turbo-guard/tests/'
const packages: WorkspacePackage[] = manifests.map(({ directory, manifest }) => ({
  name: manifest.name ?? directory,
  directory,
  declared: new Set(
    [
      manifest.dependencies,
      manifest.devDependencies,
      manifest.peerDependencies,
      manifest.optionalDependencies,
    ].flatMap((field) => Object.keys(field ?? {})),
  ),
  devOnly: new Set(
    Object.keys(manifest.devDependencies ?? {}).filter(
      (name) =>
        ![manifest.dependencies, manifest.peerDependencies, manifest.optionalDependencies].some(
          (field) => field !== undefined && name in field,
        ),
    ),
  ),
  sources: [...committed]
    .filter(
      (file) => SOURCE.test(file) && !file.startsWith(OWN_TESTS) && ownerOf(file) === directory,
    )
    .map((file) => ({ path: file, text: readFileSync(join(repoRoot, file), 'utf8') })),
}))

const imports = importViolations(packages)
const twinless = nativeWithoutTwin(committed)

const drift = hookDrift(
  workflow,
  CHECKS,
  [...committed]
    .filter((path) => path.startsWith('.githooks/'))
    .map((path) => ({ path, text: readFileSync(join(repoRoot, path), 'utf8') })),
)

const without = absent.length === 0 ? '' : ` (without ${absent.join(', ')})`
if (
  violations.length === 0 &&
  imports.length === 0 &&
  twinless.length === 0 &&
  drift.length === 0
) {
  process.stdout.write(
    `turbo-guard: ${String(tasks.length)} tasks in CI's run checked against its checkout${without}, ` +
      `${String(packages.length)} manifests against their imports, ` +
      `every .native file against its twin, and the git hooks' checks against CI's steps\n`,
  )
} else {
  for (const violation of violations)
    process.stderr.write(`turbo-guard: ${violation.task} [${violation.rule}] ${violation.detail}\n`)
  for (const found of imports)
    process.stderr.write(
      `turbo-guard: ${found.package} [${found.rule}] ${found.file} imports ${found.imports}, ` +
        (found.rule === 'undeclared-import'
          ? 'which its package.json does not declare\n'
          : 'which its package.json lists only under devDependencies, so it is absent at runtime\n'),
    )
  for (const file of twinless)
    process.stderr.write(
      `turbo-guard: [native-without-twin] ${file} has no plain twin, so desktop cannot resolve it\n`,
    )
  for (const found of drift) process.stderr.write(`turbo-guard: [${found.rule}] ${found.detail}\n`)
  process.stderr.write(
    `\nChecked as CI's checkout${without}. See "The build graph" in docs/ARCHITECTURE.md.\n`,
  )
  process.exit(1)
}
