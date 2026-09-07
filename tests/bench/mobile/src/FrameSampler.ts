/**
 * Counts frames the UI thread failed to produce.
 *
 * A scroll that stutters does so by missing frames, so sampling requestAnimationFrame and looking
 * at the gaps is the closest thing to what a person notices. At 60Hz a frame is 16.7ms; anything
 * past roughly one and a half of those is a frame that did not happen.
 *
 * It measures the thread the callbacks run on, which on React Native is the JS thread - so it sees
 * a list doing work to produce rows, and would not see a purely native scroll janking. That is the
 * right end for comparing two JavaScript list implementations.
 */
export interface FrameStats {
  frames: number
  dropped: number
  worstGapMs: number
  durationMs: number
}

export function sampleFrames(durationMs: number): Promise<FrameStats> {
  return new Promise((resolve) => {
    const gaps: number[] = []
    let last = Date.now()
    const start = last

    const tick = () => {
      const now = Date.now()
      gaps.push(now - last)
      last = now
      if (now - start < durationMs) requestAnimationFrame(tick)
      else {
        // The first gap includes however long the caller took to start scrolling, so it is not a
        // frame the list failed to produce.
        const measured = gaps.slice(1)
        resolve({
          frames: measured.length,
          dropped: measured.filter((g) => g > 25).length,
          worstGapMs: measured.reduce((worst, g) => Math.max(worst, g), 0),
          durationMs: now - start,
        })
      }
    }
    requestAnimationFrame(tick)
  })
}
