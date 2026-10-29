import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const cacheScript = join(import.meta.dirname, '../../../bridge-core/scripts/libsession-cache.sh')

/**
 * Stands in for libsession's own static-bundle.sh: the archive is the source file's content, so a
 * test can tell which state of the tree a bundle was built from. `EDIT_DURING_BUILD` edits the
 * source after the cache has hashed it, as someone working on libsession would mid-build.
 */
const FAKE_STATIC_BUNDLE = `#!/bin/bash
set -euo pipefail
mkdir -p "$1/static-deps/include"
# File timestamps come from a coarse clock: an edit in the same tick as the hash looks older.
sleep 0.1
case "\${EDIT_DURING_BUILD:-}" in
    kept) echo edited >>src.cpp ;;
    undone) cp src.cpp src.orig; echo edited >>src.cpp; cp src.orig src.cpp; rm src.orig ;;
esac
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

  const bundle = (env: Record<string, string> = {}) =>
    run(dir, `libsession_bundle "${libsession}" test-target "${dest}"`, env)
  const entries = () =>
    readdirSync(join(dir, 'cache/entries')).filter((name) => name.startsWith('v'))
  const placed = () => readFileSync(join(dest, 'libsession-util.a'), 'utf8')

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'libsession-cache-'))
    libsession = join(dir, 'libsession')
    dest = join(dir, 'dest')
    mkdirSync(join(libsession, 'utils'), { recursive: true })
    writeFileSync(join(libsession, 'src.cpp'), 'original\n')
    writeFileSync(join(libsession, 'CMakeLists.txt'), '')
    writeFileSync(join(libsession, 'utils/static-bundle.sh'), FAKE_STATIC_BUNDLE, { mode: 0o755 })
    await promisify(execFile)('git', ['init', '-q'], { cwd: libsession })
    await promisify(execFile)('git', ['add', '.'], { cwd: libsession })
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

  it.each(['kept', 'undone'])(
    'places but does not store a build whose source was edited during it (%s)',
    async (edit) => {
      const { stdout } = await bundle({ EDIT_DURING_BUILD: edit })
      expect(stdout).toContain('not caching it')
      expect(entries()).toEqual([])
      expect(placed()).toContain('original\n')
    },
  )

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
