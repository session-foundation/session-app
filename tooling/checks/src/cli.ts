import { execFileSync, spawnSync } from 'node:child_process'

import { CHECKS, commandsFor, type HookStage } from '#src/checks'

const stage = process.argv[2]
if (stage !== 'pre-commit' && stage !== 'pre-push') {
  process.stderr.write('usage: pnpm checks pre-commit|pre-push\n')
  process.exit(2)
}

const git = (...args: string[]): string => execFileSync('git', args, { encoding: 'utf8' }).trim()

function mergeBase(): string | null {
  try {
    return git('merge-base', 'HEAD', 'origin/main')
  } catch {
    return null
  }
}

// With no merge base every file counts as changed, and the per-package checks run everywhere.
const base = stage === 'pre-push' ? mergeBase() : null
const files = (
  stage === 'pre-commit'
    ? git('diff', '--cached', '--name-only')
    : base === null
      ? git('ls-files')
      : git('diff', '--name-only', `${base}...HEAD`)
)
  .split('\n')
  .filter((file) => file !== '')

for (const args of commandsFor(CHECKS, stage satisfies HookStage, files, base)) {
  process.stdout.write(`\n${stage}: pnpm ${args.join(' ')}\n`)
  // Windows ships pnpm as pnpm.cmd, which Node spawns only through a shell.
  const { status } = spawnSync('pnpm', args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (status !== 0) process.exit(status ?? 1)
}
