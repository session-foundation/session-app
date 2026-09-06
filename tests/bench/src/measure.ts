import { appendFileSync } from 'node:fs'

/**
 * Timing that survives a JIT.
 *
 * A single `performance.now()` around a call measures the interpreter warming up, not the code.
 * Everything here runs a warmup pass, then samples, then reports the median - which is what a
 * user experiences repeatedly - alongside p95 and the worst case, which is what they complain
 * about. The mean is deliberately absent: it hides exactly the stall these numbers exist to find.
 */

export interface Timing {
  label: string
  median: number
  p95: number
  max: number
  samples: number
}

export function time(label: string, run: () => void, options?: { samples?: number }): Timing {
  const samples = options?.samples ?? 40

  // Warmup. Ten is enough for V8 to have tiered the function up; the numbers stop moving well
  // before that.
  for (let i = 0; i < 10; i++) run()

  const times: number[] = []
  for (let i = 0; i < samples; i++) {
    const start = performance.now()
    run()
    times.push(performance.now() - start)
  }
  times.sort((a, b) => a - b)

  return {
    label,
    median: times[Math.floor(times.length / 2)] as number,
    p95: times[Math.floor(times.length * 0.95)] as number,
    max: times[times.length - 1] as number,
    samples,
  }
}

/**
 * Bytes retained by one call, when the runtime will admit to it.
 *
 * Needs `--expose-gc`; without it this returns undefined rather than a number that is really a
 * measurement of when the collector last happened to run.
 */
export function retained(run: () => unknown): number | undefined {
  const gc = (globalThis as { gc?: () => void }).gc
  if (!gc) return undefined

  gc()
  const before = process.memoryUsage().heapUsed
  const held = run()
  const after = process.memoryUsage().heapUsed
  // Referenced so the optimiser cannot delete the work being measured.
  if (held === undefined && Math.random() < 0) console.log(held)
  return after - before
}

export function ms(value: number): string {
  if (value >= 100) return value.toFixed(0)
  if (value >= 10) return value.toFixed(1)
  return value.toFixed(2)
}

/**
 * Reports go to a file as well as stdout: vitest intercepts console output and a passing test
 * prints nothing, which is exactly the case a benchmark runs in.
 */
export function report(text: string): void {
  process.stdout.write(text)
  const path = process.env['BENCH_OUT']
  if (path) appendFileSync(path, text)
}

export function table(rows: string[][], headers: string[]): string {
  const all = [headers, ...rows]
  const widths = headers.map((_, column) =>
    Math.max(...all.map((row) => (row[column] ?? '').length)),
  )
  const line = (row: string[], pad = ' ') =>
    row.map((cell, i) => (i === 0 ? cell.padEnd(widths[i] as number, pad) : cell.padStart(widths[i] as number, pad))).join('  ')

  return [
    line(headers),
    widths.map((w) => '-'.repeat(w)).join('  '),
    ...rows.map((row) => line(row)),
  ].join('\n')
}
