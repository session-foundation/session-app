/**
 * Timing a client from the outside.
 *
 * Deliberately not part of `ISessionApp`. That interface's rule is that anything one platform
 * cannot do belongs in a narrower interface until every platform can, and reading a
 * PerformanceObserver out of a running app is exactly that: Chromium gives it up through
 * `page.evaluate`, and the mobile drivers will need a different mechanism to answer the same
 * questions. The signatures stay primitives so that when they do, this promotes unchanged.
 */
export interface IPerformanceProbe {
  /** Start collecting. Anything before this call is not measured. */
  startProbe(): Promise<void>
  /**
   * Tasks that occupied the main thread for longer than the browser's long-task threshold,
   * which is 50ms - the point at which an interaction stops feeling connected to the tap.
   */
  readLongTasks(): Promise<{ start: number; duration: number }[]>
  /** Milliseconds from now until the element is on screen. The tap belongs to the caller. */
  timeUntilVisible(testId: string, timeoutMs?: number): Promise<number>
  /** Frames the renderer painted over `windowMs`, as a proxy for whether it kept up. */
  countFrames(windowMs: number): Promise<number>
}
