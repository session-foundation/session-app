#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

/**
 * Applies the patches under `patches/` to the libsession submodule tree.
 *
 * These are fixes waiting on upstream, not customisations: each one is a change we want made
 * in the repository that owns it, and the file here is the diff to send. A build cannot wait
 * for that, and a submodule two levels down cannot be committed from here, so the build applies
 * them and this script is what makes that idempotent and visible.
 *
 * Every patch that lands upstream is deleted here, and the day this directory is empty the
 * script goes with it.
 */

const root = fileURLToPath(new URL('..', import.meta.url))
const patches = join(root, 'patches')

/** Where each patch applies. Named rather than inferred: a patch is for one tree, not any tree. */
const targets = {
  'session-deps-libevent-with-pic.patch': 'libsession-util/cmake/session-deps',
  'session-deps-cross-cmake-toolchain.patch': 'libsession-util/cmake/session-deps',
  'session-router-macos-arm64.patch': 'libsession-util/external/session-router',
}

let applied = 0
for (const name of readdirSync(patches).filter((f) => f.endsWith('.patch'))) {
  const target = targets[name]
  if (!target) throw new Error(`patches/${name} has no entry in this script's target list`)

  const cwd = join(root, target)
  const patch = join(patches, name)
  const git = (...args) => execFileSync('git', args, { cwd, stdio: 'pipe' })

  try {
    // Already applied is the ordinary case: a build runs this every time.
    git('apply', '--reverse', '--check', patch)
    continue
  } catch {
    // Not applied yet.
  }

  git('apply', patch)
  console.log(`applied patches/${name} to ${target}`)
  applied += 1
}

if (applied === 0) console.log('libsession patches already applied')
