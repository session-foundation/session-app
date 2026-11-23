import { createLogger, PREFIX_WIDTH, Pseudonyms } from '@session/logging'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  appLog,
  installLogger,
  logStoreMilestones,
  resetLogger,
  startLogger,
  storeLogger,
} from '#src/log'
import { resetPorts, setPorts } from '#src/ports'
import { memoryPorts } from '#src/testPorts'

function capture(): string[] {
  const lines: string[] = []
  installLogger(
    createLogger({
      sink: { write: (written) => lines.push(...written) },
      pseudonyms: new Pseudonyms(new Uint8Array(16)),
      uptimeMs: () => 0,
    }),
  )
  return lines
}

interface State {
  startupError: string | null
  account: { haveAccount: boolean } | null
}

function fakeStore() {
  let listener: ((state: State, previous: State) => void) | null = null
  let state: State = { startupError: null, account: null }
  return {
    subscribe(next: (state: State, previous: State) => void) {
      listener = next
      return () => undefined
    },
    set(patch: Partial<State>) {
      const previous = state
      state = { ...state, ...patch }
      listener?.(state, previous)
    },
  }
}

afterEach(() => {
  resetPorts()
  resetLogger()
})

describe('appLog', () => {
  it('holds lines logged before the logger arrives and writes them in order', () => {
    appLog.info('ui', 'first')
    appLog.marker('lifecycle', 'second')
    const lines = capture()
    expect(lines.map((line) => line.slice(PREFIX_WIDTH))).toEqual(['first', '>>> second'])
  })

  it('times a held line by when it was logged, not by when the logger arrived', () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 9, 7, 0, 0) })
    try {
      appLog.error('session', 'start failed')
      vi.setSystemTime(Date.UTC(2026, 9, 9, 7, 0, 3))
      const lines: string[] = []
      installLogger(
        createLogger({
          sink: { write: (written) => lines.push(...written) },
          pseudonyms: new Pseudonyms(new Uint8Array(16)),
          uptimeMs: () => 5_000,
        }),
      )
      // Logged three seconds before the logger, at 5 s of uptime, arrived: so at 2 s.
      expect(lines[0]).toMatch(/^2026-10-09T07:00:00\.000Z\s+\+2\.000 ERROR/)
    } finally {
      vi.useRealTimers()
    }
  })
})

function newLogger(lines: string[]) {
  return createLogger({
    sink: { write: (written) => lines.push(...written) },
    pseudonyms: new Pseudonyms(new Uint8Array(16)),
    uptimeMs: () => 0,
  })
}

describe('startLogger', () => {
  it('writes the startup block from the ports, then the launch marker, then what was held', () => {
    setPorts(
      memoryPorts({
        build: {
          version: '1.2.3',
          commit: 'abc12345',
          buildNumber: '7',
          variant: 'development',
          libsessionCommit: '76d93c51',
        },
      }),
    )
    const lines: string[] = []
    appLog.info('session', 'held')
    startLogger(newLogger(lines), {
      launchedAtMs: Date.UTC(2026, 9, 9, 7, 41, 2),
      model: 'iPhone17,1',
      os: 'iOS 26.1',
      locale: 'en-AU',
      install: 'unknown',
      platformRows: [],
      network: {
        fake: false,
        netid: 'testnet',
        router: undefined,
        devnetSeedUrl: undefined,
        fileServerUrl: undefined,
        logSpec: '',
      },
      flagVariables: { EXPO_PUBLIC_SESSION_FLAG_DEBUG_MODE: '1', EXPO_PUBLIC_SESSION_FLAG_X: 'y' },
      previousRun: null,
    })
    expect(lines.slice(0, 3)).toEqual([
      '',
      '── Session 1.2.3 (7) launched 2026-10-09 07:41:02Z',
      '  Version        1.2.3 (7)',
    ])
    expect(lines).toContain('  libsession     76d93c51')
    expect(lines).toContain('  Network        testnet')
    expect(lines).toContain('  Transport      Session Router (default)')
    expect(lines).toContain("  Log level      libsession's default")
    expect(lines).toContain(
      '  Flags          debugMode=1, EXPO_PUBLIC_SESSION_FLAG_X=y (no such flag)',
    )
    expect(lines.slice(-2).map((line) => line.slice(PREFIX_WIDTH))).toEqual(['>>> launch', 'held'])
  })

  it('writes only the launch marker where another process wrote the block', () => {
    setPorts(memoryPorts())
    const lines: string[] = []
    startLogger(newLogger(lines), null, { process: 'renderer' })
    expect(lines.map((line) => line.slice(PREFIX_WIDTH))).toEqual(['>>> launch process=renderer'])
  })
})

describe('logStoreMilestones', () => {
  it('marks the start, the account, and a failed start with its reason', () => {
    const lines = capture()
    const store = fakeStore()
    logStoreMilestones(store)
    store.set({ account: { haveAccount: false } })
    store.set({ account: { haveAccount: true } })
    store.set({ startupError: 'database is locked' })
    expect(lines.map((line) => line.slice(PREFIX_WIDTH))).toEqual([
      '>>> start ok',
      '>>> account none',
      '>>> account created',
      '>>> start failed reason="database is locked"',
    ])
  })
})

describe('storeLogger', () => {
  it('writes every line, and echoes it to the console only when asked', () => {
    const lines = capture()
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    try {
      storeLogger(false)('critical', 'session', 'quiet', 'CoS-0-A')
      expect(error).not.toHaveBeenCalled()
      storeLogger(true)('critical', 'session', 'loud')
      storeLogger(true)('trace', 'session', 'fine')
      expect(error).toHaveBeenCalledWith('[session] loud')
      expect(debug).toHaveBeenCalledWith('[session] fine')
      expect(lines.map((line) => line.slice(PREFIX_WIDTH))).toEqual(['quiet', 'loud'])
      expect(lines[0]).toContain('[CoS-0-A]')
    } finally {
      error.mockRestore()
      debug.mockRestore()
    }
  })
})
