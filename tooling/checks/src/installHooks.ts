import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'

const git = (...args: string[]) => spawnSync('git', args, { encoding: 'utf8' })

// A tarball or CI checkout without a .git has no hooks to install, and that must not fail install;
// a copy unpacked inside another repository must not take that repository's hooks over either.
const repoRoot = realpathSync(resolve(import.meta.dirname, '../../..'))
const toplevel = git('rev-parse', '--show-toplevel')
if (toplevel.status === 0 && realpathSync(toplevel.stdout.trim()) === repoRoot) {
  const previous = git('config', 'core.hooksPath').stdout.trim()
  if (previous !== '' && previous !== '.githooks')
    process.stdout.write(`hooks: core.hooksPath was ${previous}, now .githooks\n`)
  git('config', 'core.hooksPath', '.githooks')
}
