import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { EXTENSION_LOG_DIRS, LOG_FILE_NAME, logFileName } from '@session/logging'

/**
 * Every place that checks a log file's name agrees on the pattern.
 *
 * The name is what keeps an export inside the log directory: the desktop's main process imports the
 * pattern, but the two native compressors cannot, so each spells it out again in its own language.
 * One that drifted stricter would fail every export on that platform; one that drifted looser would
 * let a part name a file outside the directory.
 *
 * Read out of the sources rather than run, because the point is the copies themselves, and neither
 * language runs here.
 */
describe('a log file name pattern', () => {
  const root = join(import.meta.dirname, '../../..')
  const module = join(root, 'apps/mobile/modules/session-logs')
  // The shared pattern without its capture groups, which only the sort needs.
  const expected = LOG_FILE_NAME.source.replace(/[()]/g, '')
  // A string literal's backslashes, unescaped: `"\\d"` in the source is `\d` in the pattern.
  const unescape = (literal: string): string => literal.replace(/\\\\/g, '\\')

  it('is the same in the Android module', () => {
    const source = readFileSync(
      join(module, 'android/src/main/java/org/getsession/sessionlogs/SessionLogsModule.kt'),
      'utf8',
    )
    const literal = /val logFile = Regex\("([^"]+)"\)/.exec(source)?.[1]
    expect(literal, 'the module names the pattern in one place').toBeDefined()
    expect(unescape(literal ?? '')).toBe(expected)
  })

  it('is the same in the iOS module', () => {
    const source = readFileSync(join(module, 'ios/SessionLogsModule.swift'), 'utf8')
    const literal = /static let logFile = "([^"]+)"/.exec(source)?.[1]
    expect(literal, 'the module names the pattern in one place').toBeDefined()
    expect(unescape(literal ?? '')).toBe(expected)
  })

  it('accepts what the writer names a file, and nothing that leaves the directory', () => {
    const pattern = new RegExp(expected)
    expect(pattern.test(logFileName(Date.UTC(2026, 9, 9), 12))).toBe(true)
    expect(pattern.test('../session-20261009T000000Z-0.log')).toBe(false)
    expect(pattern.test('session-20261009T000000Z-0.log/x')).toBe(false)
  })
})

/**
 * Every place that lets an export part name a directory beside the logs allows the same ones, for
 * the same reason as the name: a looser copy would let a part read outside the log directory.
 */
describe('the extension log directories', () => {
  const root = join(import.meta.dirname, '../../..')
  const module = join(root, 'apps/mobile/modules/session-logs')
  const quoted = (body: string): string[] => [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? '')

  it('are the same in the iOS module', () => {
    const source = readFileSync(join(module, 'ios/SessionLogsModule.swift'), 'utf8')
    const body = /static let extensionDirs: Set<String> = \[([^\]]*)\]/.exec(source)?.[1]
    expect(body, 'the module names the directories in one place').toBeDefined()
    expect(quoted(body ?? '')).toEqual([...EXTENSION_LOG_DIRS])
  })

  it('are the same in the Android module', () => {
    const source = readFileSync(
      join(module, 'android/src/main/java/org/getsession/sessionlogs/SessionLogsModule.kt'),
      'utf8',
    )
    const body = /val extensionDirs = setOf\(([^)]*)\)/.exec(source)?.[1]
    expect(body, 'the module names the directories in one place').toBeDefined()
    expect(quoted(body ?? '')).toEqual([...EXTENSION_LOG_DIRS])
  })

  it('include the one the notification extension writes to', () => {
    const source = readFileSync(
      join(root, 'apps/mobile/notification-service/NotificationService.mm'),
      'utf8',
    )
    const written = /logs \/ "([^"]+)"/.exec(source)?.[1]
    expect(EXTENSION_LOG_DIRS).toContain(written)
  })
})
