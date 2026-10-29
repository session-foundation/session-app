import { execFile } from 'node:child_process'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const cacheScript = join(import.meta.dirname, '../../../bridge-core/scripts/libsession-cache.sh')

/**
 * Stands in for libsession's own static-bundle.sh: the archive is the source file's content, so a
 * test can tell which state of the tree a bundle was built from. `EDIT_DURING_BUILD` names a file
 * to edit while it runs, as someone working on libsession would mid-build.
 */
const FAKE_STATIC_BUNDLE = `#!/bin/bash
set -euo pipefail
mkdir -p "$1/static-deps/include"
[ -z "\${EDIT_DURING_BUILD:-}" ] || echo edited >>"$EDIT_DURING_BUILD"
[ -z "\${FAIL_BUILD:-}" ] || exit 3
cp src.cpp "$1/libsession-util.a"
`

const run = (dir: string, script: string, env: Record<string, string> = {}) =>
  promisify(execFile)('bash', ['-c', `set -euo pipefail; . "${cacheScript}"; ${script}`], {
    cwd: dir,
    env: { ...process.env, SESSION_LIBSESSION_CACHE: join(dir, 'cache'), ...env },
  })

describe('libsession-cache.sh', () => {
  let dir: string
  let libsession: string
  let dest: string

  const bundle = (env: Record<string, string> = {}, from = libsession) =>
    run(dir, `libsession_bundle "${from}" test-target "${dest}"`, env)
  const git = (cwd: string, ...args: string[]) => promisify(execFile)('git', args, { cwd })
  const entries = () =>
    readdirSync(join(dir, 'cache/entries')).filter((name) => name.startsWith('v'))
  const placed = () => readFileSync(join(dest, 'libsession-util.a'), 'utf8')
  const snapshot = (path: string) => {
    const [tree] = readdirSync(join(dir, 'cache/trees')).filter((name) => name.startsWith('v'))
    return join(dir, 'cache/trees', tree ?? '', 'src', path)
  }

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'libsession-cache-'))
    libsession = join(dir, 'libsession')
    dest = join(dir, 'dest')
    mkdirSync(join(libsession, 'utils'), { recursive: true })
    writeFileSync(join(libsession, 'src.cpp'), 'original\n')
    writeFileSync(join(libsession, 'other.cpp'), 'other\n')
    writeFileSync(join(libsession, 'CMakeLists.txt'), '')
    writeFileSync(join(libsession, 'utils/static-bundle.sh'), FAKE_STATIC_BUNDLE, { mode: 0o755 })
    await git(libsession, 'init', '-q')
    await git(libsession, 'add', '.')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('stores a build and serves it from the cache', async () => {
    await bundle()
    expect(entries()).toHaveLength(1)
    expect(placed()).toBe('original\n')

    const { stdout } = await bundle()
    expect(stdout).toContain('libsession from cache')
    expect(placed()).toBe('original\n')
  })

  it('keeps an edit made during a build out of it, and builds it next time', async () => {
    await bundle({ EDIT_DURING_BUILD: join(libsession, 'src.cpp') })
    expect(placed()).toBe('original\n')
    expect(entries()).toHaveLength(1)

    await bundle()
    expect(placed()).toBe('original\nedited\n')
    expect(entries()).toHaveLength(2)
  })

  it('copies only changed files to the build tree, whichever clone it comes from', async () => {
    await bundle()
    const before = statSync(snapshot('other.cpp')).mtimeMs
    // A second clone: every file is newer than the build tree's copy, and one differs.
    const clone = join(dir, 'clone')
    await new Promise((resolve) => setTimeout(resolve, 20))
    cpSync(libsession, clone, { recursive: true })
    writeFileSync(join(clone, 'src.cpp'), 'changed\n')

    const { stdout } = await bundle({}, clone)
    expect(stdout).toContain('copying 1 changed files')
    expect(placed()).toBe('changed\n')
    expect(statSync(snapshot('other.cpp')).mtimeMs).toBe(before)
    expect(statSync(snapshot('src.cpp')).mtimeMs).toBeGreaterThan(before)
  })

  it('drops a deleted file from the build tree', async () => {
    await bundle()
    rmSync(join(libsession, 'other.cpp'))
    await bundle()
    expect(existsSync(snapshot('other.cpp'))).toBe(false)
    expect(entries()).toHaveLength(2)
  })

  it('copies a symlink to a directory as a symlink', async () => {
    symlinkSync('utils', join(libsession, 'tools'))
    await git(libsession, 'add', 'tools')
    await bundle()
    expect(lstatSync(snapshot('tools')).isSymbolicLink()).toBe(true)
  })

  it('releases the build tree when the build fails', async () => {
    await expect(bundle({ FAIL_BUILD: '1' })).rejects.toMatchObject({ code: 3 })
    expect(readdirSync(join(dir, 'cache/trees')).filter((name) => name.endsWith('.lock'))).toEqual(
      [],
    )
    expect(entries()).toEqual([])
  })

  it('places an entry at the top of the destination when linking it fails', async () => {
    const entry = join(dir, 'entry')
    mkdirSync(join(entry, 'static-deps/include'), { recursive: true })
    writeFileSync(join(entry, 'libsession-util.a'), 'archive')
    // A link or clone that fails partway, as across filesystems: the destination is already made.
    await run(
      dir,
      `cp() { case "$1" in -al|-cR) mkdir -p "$3"; return 1 ;; esac; command cp "$@"; }
      _ls_place "${entry}" "${dest}"`,
    )
    expect(placed()).toBe('archive')
    expect(readdirSync(dest).sort()).toEqual(['libsession-util.a', 'static-deps'])
  })
})
