import { describe, expect, it } from 'vitest'

import {
  buildEnvironmentHash,
  cacheable,
  captureKey,
  missingPages,
  parseCompareArgs,
  UsageError,
} from '#catalog/options'

describe('the command line', () => {
  it('defaults to the merge base, the pr tier and Argos sensitivity', () => {
    expect(parseCompareArgs([])).toEqual({
      baseRef: undefined,
      tier: 'pr',
      pages: undefined,
      sensitivity: 0.5,
      refresh: false,
      keepWorktree: false,
    })
  })

  it('takes a base ref and options in any order, and the -- pnpm may pass on', () => {
    expect(
      parseCompareArgs([
        '--',
        '--tier',
        'nightly',
        'origin/main~3',
        '--refresh',
        '--sensitivity',
        '0',
        '--pages',
        'messageQuote, messageFrame.bubble,',
      ]),
    ).toMatchObject({
      baseRef: 'origin/main~3',
      tier: 'nightly',
      sensitivity: 0,
      refresh: true,
      pages: ['messageQuote', 'messageFrame.bubble'],
    })
  })

  it('refuses what it cannot act on', () => {
    expect(() => parseCompareArgs(['--tier', 'weekly'])).toThrow(UsageError)
    expect(() => parseCompareArgs(['--sensitivity', '2'])).toThrow(UsageError)
    expect(() => parseCompareArgs(['--colour'])).toThrow(UsageError)
    expect(() => parseCompareArgs(['--pages'])).toThrow(UsageError)
    expect(() => parseCompareArgs(['--pages', ' , '])).toThrow(UsageError)
    expect(() => parseCompareArgs(['a', 'b'])).toThrow(UsageError)
  })
})

describe('a cached capture', () => {
  const capture = {
    sha: 'abc',
    tier: 'pr',
    platform: 'darwin',
    arch: 'arm64',
    environmentHash: 'e0',
  } as const

  it('is named by commit, tier, host and build environment', () => {
    expect(captureKey(capture)).toBe('abc-pr-darwin-arm64-env-e0')
    expect(captureKey({ ...capture, tier: 'nightly' })).not.toBe(captureKey(capture))
    expect(captureKey({ ...capture, environmentHash: 'e1' })).not.toBe(captureKey(capture))
  })

  it('is told apart when an older base was given the hidden-run change', () => {
    expect(captureKey({ ...capture, overlayHash: 'f00d' })).toBe(
      'abc-pr-darwin-arm64-env-e0-hidden-f00d',
    )
  })

  it('is told apart by the pages it was limited to', () => {
    const some = captureKey({ ...capture, pages: ['messageQuote'] })
    expect(some).toMatch(/^abc-pr-darwin-arm64-env-e0-pages-[0-9a-f]{12}$/)
    expect(captureKey({ ...capture, pages: ['messageFrame'] })).not.toBe(some)
  })

  it('is kept only when the spec passed and wrote every page it listed', () => {
    expect(cacheable({ specPassed: true, complete: true })).toBe(true)
    // A base from before the page list: its passing spec is the only word on it.
    expect(cacheable({ specPassed: true, complete: null })).toBe(true)
    expect(cacheable({ specPassed: false, complete: true })).toBe(false)
    expect(cacheable({ specPassed: false, complete: null })).toBe(false)
    expect(cacheable({ specPassed: true, complete: false })).toBe(false)
  })
})

describe('the build environment', () => {
  const flags = { EXPO_PUBLIC_SESSION_FLAG_A: '1', EXPO_PUBLIC_SESSION_NETWORK: 'testnet' }

  it('hashes the .env and every EXPO_PUBLIC_ variable, in any order', () => {
    const hash = buildEnvironmentHash('A=1\n', flags)
    expect(hash).toMatch(/^[0-9a-f]{12}$/)
    expect(
      buildEnvironmentHash('A=1\n', {
        EXPO_PUBLIC_SESSION_NETWORK: 'testnet',
        EXPO_PUBLIC_SESSION_FLAG_A: '1',
      }),
    ).toBe(hash)
  })

  it('changes with the .env, its absence and any public variable, and nothing else', () => {
    const hash = buildEnvironmentHash('A=1\n', flags)
    expect(buildEnvironmentHash('A=2\n', flags)).not.toBe(hash)
    expect(buildEnvironmentHash(null, flags)).not.toBe(buildEnvironmentHash('', flags))
    expect(buildEnvironmentHash('A=1\n', { ...flags, EXPO_PUBLIC_SESSION_FLAG_A: '0' })).not.toBe(
      hash,
    )
    expect(buildEnvironmentHash('A=1\n', { ...flags, EXPO_PUBLIC_SESSION_FLAG_B: '1' })).not.toBe(
      hash,
    )
    expect(buildEnvironmentHash('A=1\n', { ...flags, HOME: '/elsewhere' })).toBe(hash)
  })
})

describe('a capture the spec did not finish', () => {
  it('names the pages it listed and never wrote, in its order', () => {
    expect(missingPages(['a', 'b', 'c', 'd'], ['c', 'a'])).toEqual(['b', 'd'])
    expect(missingPages(['a'], ['a', 'extra'])).toEqual([])
  })
})
