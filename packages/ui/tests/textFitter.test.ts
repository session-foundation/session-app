import { describe, expect, it } from 'vitest'

import { createTextFitter } from '#src/textFitter'

/** The size every fake line is laid out at before the fitter shrinks it. Not a style. */
const NATURAL_SIZE = 10

interface FakeLine {
  id: number
  /** The width its text wants at `NATURAL_SIZE`. */
  naturalWidth: number
  box: number
  fontSize: number
  container: string
}

/**
 * A page that records every read and write, and counts how often it would have to lay itself out:
 * once for the first read, and again for every read that follows a write.
 */
function fakePage() {
  let dirty = true
  let layouts = 0
  const log: string[] = []
  const flushes: (() => void)[] = []
  const observed = new Set<string>()
  let onResize: ((containers: readonly string[]) => void) | null = null

  const read = (what: string) => {
    if (dirty) layouts++
    dirty = false
    log.push(`read ${what}`)
  }
  const write = (what: string) => {
    dirty = true
    log.push(`write ${what}`)
  }

  const fitter = createTextFitter<FakeLine, string>({
    reset: (line) => {
      write(`reset ${String(line.id)}`)
      line.fontSize = NATURAL_SIZE
    },
    widths: (line) => {
      read(`widths ${String(line.id)}`)
      return { box: line.box, content: (line.naturalWidth * line.fontSize) / NATURAL_SIZE }
    },
    fontSize: (line) => {
      read(`size ${String(line.id)}`)
      return line.fontSize
    },
    resize: (line, size) => {
      write(`resize ${String(line.id)}`)
      line.fontSize = size
    },
    container: (line) => line.container,
    watch: (resized) => {
      onResize = resized
      return {
        observe: (c) => observed.add(c),
        unobserve: (c) => observed.delete(c),
      }
    },
    schedule: (flush) => flushes.push(flush),
  })

  return {
    fitter,
    log,
    observed,
    layouts: () => layouts,
    scheduled: () => flushes.length,
    flush: () => {
      for (const f of flushes.splice(0)) f()
    },
    resize: (...containers: string[]) => onResize?.(containers),
    resetCount: () => {
      layouts = 0
      log.length = 0
    },
  }
}

const line = (id: number, naturalWidth: number, box: number, container = 'row'): FakeLine => ({
  id,
  naturalWidth,
  box,
  fontSize: NATURAL_SIZE,
  container,
})

describe('the shared text fitter', () => {
  it('fits a hundred lines with two layouts, not a hundred', () => {
    const page = fakePage()
    // Half of them overflow and have to shrink, which is the worst case for interleaving.
    const lines = Array.from({ length: 100 }, (_, i) =>
      line(i, i % 2 === 0 ? 120 : 60, 80, `row-${String(i)}`),
    )
    for (const l of lines) page.fitter.watch(l)

    expect(page.scheduled()).toBe(1)
    page.flush()
    expect(page.layouts()).toBe(2)
    for (const l of lines)
      if (l.naturalWidth > l.box)
        expect((l.naturalWidth * l.fontSize) / NATURAL_SIZE).toBeLessThan(l.box)
      else expect(l.fontSize).toBe(NATURAL_SIZE)
  })

  it('only reads a line that fits, and never writes it', () => {
    const page = fakePage()
    page.fitter.watch(line(1, 60, 80))
    page.flush()
    expect(page.log).toEqual(['read widths 1'])
  })

  it('measures a shrunk line at its own size again when it changes', () => {
    const page = fakePage()
    const l = line(1, 120, 80)
    page.fitter.watch(l)
    page.flush()
    expect(l.fontSize).toBeLessThan(NATURAL_SIZE)

    // The text got shorter: back to its own size, and it fits.
    l.naturalWidth = 60
    page.resetCount()
    page.fitter.request(l)
    page.flush()
    expect(l.fontSize).toBe(NATURAL_SIZE)
    expect(page.log).toEqual(['write reset 1', 'read widths 1'])
  })

  it('fits every line of a container that resized, there and then', () => {
    const page = fakePage()
    const a = line(1, 60, 80, 'list')
    const b = line(2, 70, 80, 'list')
    page.fitter.watch(a)
    page.fitter.watch(b)
    page.flush()

    a.box = 40
    b.box = 40
    page.resize('list')
    expect(a.fontSize).toBeLessThan(NATURAL_SIZE)
    expect(b.fontSize).toBeLessThan(NATURAL_SIZE)
    expect(page.scheduled()).toBe(0)
  })

  it('watches a container once for all its lines, and lets go with the last', () => {
    const page = fakePage()
    const stopA = page.fitter.watch(line(1, 60, 80, 'list'))
    const stopB = page.fitter.watch(line(2, 60, 80, 'list'))
    expect([...page.observed]).toEqual(['list'])
    stopA()
    expect([...page.observed]).toEqual(['list'])
    stopB()
    expect(page.observed.size).toBe(0)
  })

  it('drops a line that goes before its turn', () => {
    const page = fakePage()
    const stop = page.fitter.watch(line(1, 120, 80))
    stop()
    page.flush()
    expect(page.log).toEqual([])
  })
})
