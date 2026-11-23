import { afterEach, describe, expect, it } from 'vitest'

import { memoryPorts, resetPorts, setPorts } from '#src/index'
import {
  FLAGS,
  envVarFor,
  flag,
  flagOverrideRows,
  flagSnapshot,
  flagSource,
  setFlagToggles,
  subscribeFlagToggles,
} from '#src/flags'
import type { FlagName } from '#src/flags'

/** Installs ports whose only override is the one under test. */
function withEnv(env: Record<string, string>): void {
  setPorts(memoryPorts({ flags: { override: (name) => env[name] ?? null } }))
}

afterEach(() => {
  resetPorts()
  setFlagToggles({})
})

describe('feature flags', () => {
  it('derives an environment variable name per flag, with no collisions', () => {
    expect(envVarFor('recoveryPhraseLong')).toBe('EXPO_PUBLIC_SESSION_FLAG_RECOVERY_PHRASE_LONG')
    const names = (Object.keys(FLAGS) as FlagName[]).map(envVarFor)
    expect(new Set(names).size).toBe(names.length)
  })

  it('falls back to the default when nothing is set', () => {
    withEnv({})
    expect(flag('recoveryPhraseLong')).toBe(FLAGS.recoveryPhraseLong)
  })

  it('turns on for anything that is unambiguously a person typing yes', () => {
    for (const value of ['1', 'true', 'TRUE', 'yes', ' on ']) {
      withEnv({ EXPO_PUBLIC_SESSION_FLAG_RECOVERY_PHRASE_LONG: value })
      expect(flag('recoveryPhraseLong'), value).toBe(true)
    }
  })

  it('turns off for anything that is unambiguously a person typing no', () => {
    // The mirror of the test above, and it needs a flag that defaults on to mean anything: a
    // default-off flag reads false whether the value was understood or ignored.
    for (const value of ['0', 'false', 'FALSE', 'no', ' off ']) {
      withEnv({ EXPO_PUBLIC_SESSION_FLAG_RECOVERY_PHRASE_SHORT: value })
      expect(flag('recoveryPhraseShort'), value).toBe(false)
    }
  })

  it('ignores a value it does not understand rather than guessing', () => {
    // The asymmetry is deliberate: a variable set by accident, or misspelled, must not enable
    // something. Falling through to the default is the safe direction.
    for (const value of ['', '  ', 'maybe', 'ON!', '2']) {
      withEnv({ EXPO_PUBLIC_SESSION_FLAG_RECOVERY_PHRASE_LONG: value })
      expect(flag('recoveryPhraseLong'), JSON.stringify(value)).toBe(false)
    }
  })

  it('reports every flag at once, for a bug report to quote', () => {
    withEnv({ EXPO_PUBLIC_SESSION_FLAG_RECOVERY_PHRASE_LONG: '1' })
    const snapshot = flagSnapshot()
    expect(Object.keys(snapshot).sort()).toEqual(Object.keys(FLAGS).sort())
    expect(snapshot.recoveryPhraseLong).toBe(true)
    expect(snapshot.recoveryPhraseLanguage).toBe(FLAGS.recoveryPhraseLanguage)
  })
})

describe('flagOverrideRows', () => {
  it('names each flag set, with its value as written, in the order of the table', () => {
    expect(
      flagOverrideRows({
        EXPO_PUBLIC_SESSION_FLAG_DEBUG_MODE: 'ture',
        EXPO_PUBLIC_SESSION_FLAG_RECOVERY_PHRASE_LONG: '1',
        PATH: '/usr/bin',
      }),
    ).toEqual(['recoveryPhraseLong=1', 'debugMode=ture'])
  })

  it('names a variable with the prefix that is no flag, so a misspelling shows', () => {
    expect(
      flagOverrideRows({
        EXPO_PUBLIC_SESSION_FLAG_DISABLE_ANIMATOINS: '1',
        EXPO_PUBLIC_SESSION_FLAG_DISABLE_ANIMATIONS: '0',
      }),
    ).toEqual([
      'disableAnimations=0',
      'EXPO_PUBLIC_SESSION_FLAG_DISABLE_ANIMATOINS=1 (no such flag)',
    ])
  })

  it('leaves out what is unset or empty', () => {
    expect(
      flagOverrideRows({
        EXPO_PUBLIC_SESSION_FLAG_DEBUG_MODE: '',
        EXPO_PUBLIC_SESSION_FLAG_RECOVERY_PHRASE_LONG: undefined,
        EXPO_PUBLIC_SESSION_FLAG_NOT_A_FLAG: '',
      }),
    ).toEqual([])
  })
})

describe('a flag switched in Developer Settings', () => {
  it('wins over the environment, either way', () => {
    withEnv({ EXPO_PUBLIC_SESSION_FLAG_DISABLE_ANIMATIONS: '1' })
    expect(flag('disableAnimations')).toBe(true)
    setFlagToggles({ disableAnimations: false })
    expect(flag('disableAnimations')).toBe(false)
    expect(flagSource('disableAnimations')).toBe('toggle')
  })

  it('gives way to the environment, then the table, once it is reset', () => {
    withEnv({ EXPO_PUBLIC_SESSION_FLAG_DISABLE_ANIMATIONS: 'on' })
    setFlagToggles({ disableAnimations: false })
    setFlagToggles({})
    expect(flag('disableAnimations')).toBe(true)
    expect(flagSource('disableAnimations')).toBe('environment')

    withEnv({})
    expect(flag('disableAnimations')).toBe(FLAGS.disableAnimations)
    expect(flagSource('disableAnimations')).toBe('default')
  })

  it('counts as the environment only when the value is understood', () => {
    withEnv({ EXPO_PUBLIC_SESSION_FLAG_DISABLE_ANIMATIONS: 'maybe' })
    expect(flagSource('disableAnimations')).toBe('default')
  })
})

describe('the switched flags', () => {
  it('tell a subscriber when they change, until it unsubscribes', () => {
    withEnv({})
    let calls = 0
    const stop = subscribeFlagToggles(() => {
      calls += 1
    })
    setFlagToggles({ debugMode: true })
    expect(calls).toBe(1)
    stop()
    setFlagToggles({})
    expect(calls).toBe(1)
  })

  /** Debug mode is stored as a switch, so one stored off holds where the environment says on. */
  it('decide debug mode over the environment', () => {
    withEnv({ EXPO_PUBLIC_SESSION_FLAG_DEBUG_MODE: '1' })
    expect(flag('debugMode')).toBe(true)
    setFlagToggles({ debugMode: false })
    expect(flag('debugMode')).toBe(false)
  })
})
