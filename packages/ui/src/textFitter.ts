import { fittedFontSize } from './fittedFontSize'

/** What the fitter needs of the page, so that it can be exercised without one. */
export interface FitHost<Line, Container> {
  /** Clears a size the fitter set, so the line lays out at its own again. */
  reset(line: Line): void
  /** The width the line has, and the width its text wants. Reads layout. */
  widths(line: Line): { box: number; content: number }
  /** The size the line is laid out at. Read only for a line that overflows. */
  fontSize(line: Line): number
  resize(line: Line, fontSize: number): void
  /** Whose resizing should fit the line again, or null for none. */
  container(line: Line): Container | null
  /** Calls `onResize` with the containers that changed size; null where nothing can watch. */
  watch(onResize: (containers: readonly Container[]) => void): ContainerWatch<Container> | null
  /** Runs `flush` once, before the page is next painted. */
  schedule(flush: () => void): void
}

interface ContainerWatch<Container> {
  observe(container: Container): void
  unobserve(container: Container): void
}

export interface TextFitter<Line> {
  /** Fits `line` now and whenever its container resizes, until the returned function is called. */
  watch(line: Line): () => void
  /** Fits `line` again: its text or its size changed. */
  request(line: Line): void
}

/**
 * Fits single lines of text to their boxes, all of them together.
 *
 * **Every line in one pass, reads before writes.**  Measuring a line reads layout, and a read after
 * any write makes the browser lay the page out again then and there.  Fitted one at a time, N lines
 * interleave N reads with N writes, and the page is laid out N times in one frame.  Here every line
 * waiting is reset, then measured, then resized, so a frame costs a layout or two however many
 * lines there are.  One container watch covers them all for the same reason.
 *
 * A line that fits is only read, never written, which at the default text size is nearly all of
 * them.
 */
export function createTextFitter<Line, Container>(
  host: FitHost<Line, Container>,
): TextFitter<Line> {
  const pending = new Set<Line>()
  const fitted = new Set<Line>()
  const lines = new Map<Container, Set<Line>>()
  const containers = new Map<Line, Container>()
  let watching: ContainerWatch<Container> | null | undefined
  let scheduled = false

  const flush = () => {
    scheduled = false
    if (pending.size === 0) return
    const batch = [...pending]
    pending.clear()

    // Writes first: a line shrunk before is measured at its own size again, since its text may
    // fit now.
    for (const line of batch) if (fitted.delete(line)) host.reset(line)

    // Every read, which lays the page out once...
    const measured = batch.map((line) => {
      const { box, content } = host.widths(line)
      return { line, box, content, size: content > box ? host.fontSize(line) : 0 }
    })

    // ...then every write.
    const shrunk: { line: Line; size: number }[] = []
    for (const { line, box, content, size } of measured) {
      const fit = size > 0 ? fittedFontSize(size, box, content) : null
      if (fit === null) continue
      host.resize(line, fit)
      fitted.add(line)
      shrunk.push({ line, size: fit })
    }

    // Text does not scale exactly with its size, so a shrunk line can still be a pixel over: one
    // more pass, reads then writes, over the shrunk lines alone settles it.
    const again = shrunk.map(({ line, size }) => ({ line, size, ...host.widths(line) }))
    for (const { line, size, box, content } of again) {
      const fit = fittedFontSize(size, box, content)
      if (fit !== null) host.resize(line, fit)
    }
  }

  const request = (line: Line) => {
    pending.add(line)
    if (scheduled) return
    scheduled = true
    host.schedule(flush)
  }

  const watcher = () => {
    if (watching === undefined)
      watching = host.watch((resized) => {
        for (const container of resized)
          for (const line of lines.get(container) ?? []) pending.add(line)
        // Already after layout and before paint: fitted here, not a frame later.
        flush()
      })
    return watching
  }

  return {
    watch(line) {
      const container = host.container(line)
      if (container !== null) {
        containers.set(line, container)
        const siblings = lines.get(container)
        if (siblings === undefined) {
          lines.set(container, new Set([line]))
          watcher()?.observe(container)
        } else siblings.add(line)
      }
      request(line)

      return () => {
        pending.delete(line)
        fitted.delete(line)
        const owner = containers.get(line)
        containers.delete(line)
        if (owner === undefined) return
        const siblings = lines.get(owner)
        siblings?.delete(line)
        if (siblings?.size === 0) {
          lines.delete(owner)
          watching?.unobserve(owner)
        }
      }
    },
    request,
  }
}

/** The page's own: one for every `FitText` on it. */
export const textFitter: TextFitter<HTMLElement> = createTextFitter<HTMLElement, Element>({
  reset: (line) => {
    line.style.fontSize = ''
  },
  widths: (line) => ({ box: line.clientWidth, content: line.scrollWidth }),
  fontSize: (line) => parseFloat(getComputedStyle(line).fontSize),
  resize: (line, fontSize) => {
    line.style.fontSize = `${String(fontSize)}px`
  },
  container: (line) => line.parentElement,
  watch: (onResize) =>
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver((entries) => {
          onResize(entries.map((entry) => entry.target))
        }),
  // A microtask runs before the browser paints, so a line rendered in this commit is fitted before
  // anyone sees it at the wrong size.
  schedule: (flush) => {
    queueMicrotask(flush)
  },
})
