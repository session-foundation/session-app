import { describe, expect, it } from 'vitest'

import { utf8 } from '#src/sha256'
import {
  consoleDirectory,
  LogWriter,
  basicUtc,
  logFileName,
  logSpan,
  readPreviousRun,
  sortLogFiles,
} from '#src/writer'

import { memoryDirectory } from './helpers'

const LAUNCH = Date.UTC(2026, 9, 8, 3, 20, 9, 500)
const noTimers = { setTimeout: () => 1, clearTimeout: () => undefined }

describe('names', () => {
  it('has no spaces or colons', () => {
    expect(basicUtc(LAUNCH)).toBe('20261008T032009Z')
    expect(logFileName(LAUNCH, 0)).toBe('session-20261008T032009Z-0.log')
  })

  it('sorts by launch and then numerically by part', () => {
    const names = [
      'session-20261008T032009Z-10.log',
      'session-20261007T000000Z-3.log',
      'session-20261008T032009Z-9.log',
      'notes.txt',
    ]
    expect(sortLogFiles(names.map((name) => ({ name }))).map((f) => f.name)).toEqual([
      'session-20261007T000000Z-3.log',
      'session-20261008T032009Z-9.log',
      'session-20261008T032009Z-10.log',
    ])
  })
})

describe('LogWriter', () => {
  it('starts a new file for the launch and buffers until flushed', async () => {
    const dir = memoryDirectory()
    const writer = await LogWriter.open(dir, { launchMs: LAUNCH, timers: noTimers })
    writer.write(['one', 'two'], false)
    expect(dir.files.size).toBe(0)
    await writer.flush()
    expect(dir.files.get('session-20261008T032009Z-0.log')).toBe('one\ntwo\n')
  })

  it('writes urgent lines without waiting for the timer', async () => {
    const dir = memoryDirectory()
    const writer = await LogWriter.open(dir, { launchMs: LAUNCH, timers: noTimers })
    writer.write(['now'], true)
    await writer.flush()
    expect(dir.files.get(writer.currentFile)).toBe('now\n')
  })

  it('appends urgently only for an urgent line or an urgent flush', async () => {
    const dir = memoryDirectory()
    const timer: { fire: (() => void) | null } = { fire: null }
    const timers = {
      setTimeout: (handler: () => void) => {
        timer.fire = handler
        return 1
      },
      clearTimeout: () => undefined,
    }
    const writer = await LogWriter.open(dir, { launchMs: LAUNCH, timers })

    // The two-second flush may be written in the background.
    writer.write(['routine'], false)
    expect(timer.fire).not.toBeNull()
    timer.fire?.()
    await writer.flush()
    // An urgent line goes out urgently, and so does a flush asked to.
    writer.write(['now'], true)
    await writer.flush()
    writer.write(['backgrounding'], false)
    await writer.flush(true)

    expect(dir.appends).toEqual([false, true, true])
    expect(dir.files.get(writer.currentFile)).toBe('routine\nnow\nbackgrounding\n')
  })

  it('rotates at the size limit, at a line boundary', async () => {
    const dir = memoryDirectory()
    const writer = await LogWriter.open(dir, {
      launchMs: LAUNCH,
      maxFileBytes: 10,
      timers: noTimers,
    })
    writer.write(['aaaa', 'bbbb', 'cccc'], false)
    await writer.flush()
    expect([...dir.files]).toEqual([
      ['session-20261008T032009Z-0.log', 'aaaa\nbbbb\n'],
      ['session-20261008T032009Z-1.log', 'cccc\n'],
    ])
  })

  it('deletes whole files from the oldest end to stay in budget', async () => {
    const dir = memoryDirectory({
      'session-20261001T000000Z-0.log': 'x'.repeat(10),
      'session-20261002T000000Z-0.log': 'y'.repeat(10),
    })
    const writer = await LogWriter.open(dir, {
      launchMs: LAUNCH,
      budgetBytes: 25,
      timers: noTimers,
    })
    writer.write(['zzzzzzz'], false)
    await writer.flush()
    expect([...dir.files.keys()]).toEqual(['session-20261002T000000Z-0.log', writer.currentFile])
  })

  it('keeps writing when an old file will not delete, and says so', async () => {
    const dir = memoryDirectory({
      'session-20261001T000000Z-0.log': 'x'.repeat(10),
      'session-20261002T000000Z-0.log': 'y'.repeat(10),
    })
    dir.remove = () => Promise.reject(new Error('EBUSY'))
    const errors: unknown[] = []
    const writer = await LogWriter.open(dir, {
      launchMs: LAUNCH,
      budgetBytes: 25,
      timers: noTimers,
      onError: (error) => errors.push(error),
    })
    writer.write(['first'], false)
    await writer.flush()
    writer.write(['second'], false)
    await writer.flush()
    expect(dir.files.get(writer.currentFile)).toBe('first\nsecond\n')
    // Reported once, not before every write.
    expect(errors).toHaveLength(1)
  })

  it('never deletes the file it is writing', async () => {
    const dir = memoryDirectory()
    const writer = await LogWriter.open(dir, { launchMs: LAUNCH, budgetBytes: 4, timers: noTimers })
    writer.write(['longer than the budget'], false)
    await writer.flush()
    expect(dir.files.has(writer.currentFile)).toBe(true)
  })

  it('numbers after a launch in the same second rather than appending to it', async () => {
    const dir = memoryDirectory({ 'session-20261008T032009Z-0.log': 'earlier\n' })
    const writer = await LogWriter.open(dir, { launchMs: LAUNCH, timers: noTimers })
    expect(writer.currentFile).toBe('session-20261008T032009Z-1.log')
  })

  it('reports how the previous run ended', async () => {
    const clean = await LogWriter.open(
      memoryDirectory({
        'session-20261001T000000Z-0.log':
          'x INFO [lifecycle] >>> launch\nx INFO [lifecycle] >>> background\n',
      }),
      { launchMs: LAUNCH, timers: noTimers },
    )
    expect(clean.previousRun).toEqual({
      file: 'session-20261001T000000Z-0.log',
      endedCleanly: true,
      lastMarker: 'background',
    })

    const failed = readPreviousRun(
      'f.log',
      'x >>> launch\nx >>> start failed reason="locked" ms=3\n',
    )
    expect(failed.lastMarker).toBe('start failed')

    const died = readPreviousRun('f.log', 'x >>> launch\nx >>> foreground\nsomething\n')
    expect(died).toEqual({ file: 'f.log', endedCleanly: false, lastMarker: 'foreground' })
    // A desktop restart skips the quit marker, and writes its own.
    const restarted = readPreviousRun('f.log', 'x >>> launch\nx >>> restart\n')
    expect(restarted).toEqual({ file: 'f.log', endedCleanly: true, lastMarker: 'restart' })
  })

  it('reads only the end of the previous file where the directory can, whole lines only', async () => {
    const name = 'session-20261001T000000Z-0.log'
    // Two-byte characters, so the last 16 KiB starts inside one; the line it starts in names a
    // marker that must not be taken for the last one.
    const text =
      `x INFO [lifecycle] >>> launch\n${'é'.repeat(9_000)}ab x >>> quit\n` +
      `x INFO [lifecycle] >>> foreground\n${'ü'.repeat(3_000)}\n`
    const bytes = utf8(text)
    const read: string[] = []
    const dir = {
      ...memoryDirectory(),
      list: () => Promise.resolve([{ name, sizeBytes: bytes.length }]),
      read: () => Promise.reject(new Error('read whole')),
      readTail: (file: string, tailBytes: number) => {
        read.push(`${file} ${String(tailBytes)}`)
        return Promise.resolve(bytes.slice(Math.max(0, bytes.length - tailBytes)))
      },
    }
    const writer = await LogWriter.open(dir, { launchMs: LAUNCH, timers: noTimers })
    expect(read).toEqual([`${name} 16384`])
    expect(writer.previousRun).toEqual({
      file: name,
      endedCleanly: false,
      lastMarker: 'foreground',
    })
  })

  it('drops the line a tail began inside, even when it is the only marker', async () => {
    const name = 'session-20261001T000000Z-0.log'
    const bytes = utf8(`${'é'.repeat(9_000)}a x >>> quit\n`)
    const dir = {
      ...memoryDirectory(),
      list: () => Promise.resolve([{ name, sizeBytes: bytes.length }]),
      readTail: (_file: string, tailBytes: number) =>
        Promise.resolve(bytes.slice(bytes.length - tailBytes)),
    }
    const writer = await LogWriter.open(dir, { launchMs: LAUNCH, timers: noTimers })
    expect(writer.previousRun?.lastMarker).toBeNull()
  })

  it('reads a file shorter than the tail whole, first line included', async () => {
    const name = 'session-20261001T000000Z-0.log'
    const bytes = utf8('x é >>> background\n')
    const dir = {
      ...memoryDirectory(),
      list: () => Promise.resolve([{ name, sizeBytes: bytes.length }]),
      readTail: () => Promise.resolve(bytes),
    }
    const writer = await LogWriter.open(dir, { launchMs: LAUNCH, timers: noTimers })
    expect(writer.previousRun?.lastMarker).toBe('background')
  })

  it('keeps writing after a failed append, and reports it', async () => {
    const dir = memoryDirectory()
    const errors: unknown[] = []
    let fail = true
    const flaky = {
      ...dir,
      append: (name: string, text: string, urgent: boolean) => {
        if (fail) {
          fail = false
          return Promise.reject(new Error('disk full'))
        }
        return dir.append(name, text, urgent)
      },
    }
    const writer = await LogWriter.open(flaky, {
      launchMs: LAUNCH,
      timers: noTimers,
      onError: (e) => errors.push(e),
    })
    writer.write(['lost'], true)
    writer.write(['kept'], true)
    await writer.flush()
    expect(errors).toHaveLength(1)
    expect(dir.files.get(writer.currentFile)).toBe('kept\n')
  })
})

describe('logSpan', () => {
  const NAME = 'session-20261001T000000Z-0.log'
  const block = '\n── Session 1.0.0 launched 2026-10-01 00:00:00Z\n  Version        1.0.0\n'
  const timed = (n: number) => `2026-10-01T00:00:${String(n).padStart(2, '0')}.000Z      +0.000 x`

  /** A directory that serves one file by its ends only, and records how much it was asked for. */
  function endsOnly(text: string) {
    const bytes = utf8(text)
    const asked: string[] = []
    return {
      asked,
      dir: {
        ...memoryDirectory(),
        read: () => Promise.reject(new Error('read whole')),
        readHead: (_file: string, headBytes: number) => {
          asked.push(`head ${String(headBytes)}`)
          return Promise.resolve(bytes.slice(0, headBytes))
        },
        readTail: (_file: string, tailBytes: number) => {
          asked.push(`tail ${String(tailBytes)}`)
          return Promise.resolve(bytes.slice(Math.max(0, bytes.length - tailBytes)))
        },
      },
    }
  }

  it('reads only the ends of a large file, past its startup block', async () => {
    const lines = Array.from({ length: 2_000 }, (_, n) => timed(n % 60))
    const { dir, asked } = endsOnly(`${block}${lines.join('\n')}\n`)
    expect(await logSpan(dir, NAME, NAME)).toEqual({
      firstLine: timed(0),
      lastLine: timed(1_999 % 60),
    })
    expect(asked).toEqual(['head 16384', 'tail 16384'])
  })

  it('never returns the line a read cut through', async () => {
    const long = `${timed(1)} ${'x'.repeat(20_000)}`
    const { dir } = endsOnly(`${long}\n${timed(2)}\n`)
    expect(await logSpan(dir, NAME, NAME)).toEqual({ firstLine: null, lastLine: timed(2) })
  })

  it('reads a directory without offsets whole, and gives nulls for a missing file', async () => {
    const dir = memoryDirectory({ [NAME]: `${block}${timed(3)}\n${timed(4)}\n` })
    expect(await logSpan(dir, NAME, NAME)).toEqual({ firstLine: timed(3), lastLine: timed(4) })
    const gone = { ...dir, read: () => Promise.reject(new Error('ENOENT')) }
    expect(await logSpan(gone, NAME, NAME)).toEqual({ firstLine: null, lastLine: null })
  })
})

describe('consoleDirectory', () => {
  it('prints each write, keeps nothing, and lets a writer run on it', async () => {
    const printed: string[] = []
    const writer = await LogWriter.open(
      consoleDirectory((text) => printed.push(text)),
      {
        launchMs: LAUNCH,
        timers: noTimers,
      },
    )
    writer.write(['one', 'two'], true)
    await writer.flush()
    expect(printed).toEqual(['one\ntwo'])
    expect(writer.files()).toEqual([{ name: writer.currentFile, sizeBytes: 'one\ntwo\n'.length }])
  })
})
