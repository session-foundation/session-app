import { expect, test } from '@playwright/test'
import { ELEMENT } from '@session/test-ids'

import { DesktopApp } from '../harness/DesktopApp'

/**
 * Tier three: the whole desktop path, measured as a person experiences it.
 *
 * Tiers one and two measured pieces - the decode, the projection, the C++ and the database. This
 * measures what none of them can reach: React reconciling and committing, and the main thread
 * being unavailable while it does. That is the term every earlier tier predicted would dominate
 * and none of them could see.
 *
 * Run it by hand, like the rest of the e2e suite:
 *   pnpm --filter @session/desktop build
 *   cd tests/e2e && env -u ELECTRON_RUN_AS_NODE pnpm exec playwright test performance
 *
 * Measured on an Apple Silicon Mac, before the lists were windowed and after, same spec both
 * times. Recorded here rather than only in a report because the numbers are what the bounds in
 * this file are set against, and a bound whose origin nobody can find is a bound nobody will
 * trust to change:
 *
 *   rows   to list          tap to convo   long tasks   worst block
 *   100     59 ->  46 ms     39 ->  3 ms    0 -> 0        0 ->   0 ms
 *   1000   258 ->  43 ms    103 -> 42 ms    1 -> 0      198 ->   0 ms
 *   5000  1059 ->  53 ms    410 -> 42 ms    2 -> 0      879 ->   0 ms
 *
 * The interesting column is `to list`: 18x growth from a hundred rows to five thousand before,
 * 1.15x after. That flatness is what windowing buys and what this spec asserts, as a ratio rather
 * than a duration so it means the same on a CI runner.
 *
 * The whole suite is ~5.5 s warm and ~12 s including a cold desktop build. It needs no native
 * addon - the harness sets SESSION_FAKE - and Playwright drives the app's own Electron binary, so
 * there is no browser download either.
 */

const SIZES = [100, 1000, 5000]

interface Row {
  peers: number
  toList: number
  toConversation: number
  longTasks: number
  worstTask: number
  fps: number
}

const rows: Row[] = []

/**
 * The one long task the first render may take: each component resolving its styles for the first
 * time, all in one commit, before there is anything on screen to respond. About 60ms at every list
 * size on an Apple Silicon Mac, since it does not grow with the list. Held to a budget of its own
 * rather than to none, so it can still regress; everything after the list is up stays at none.
 */
const STARTUP_BUDGET_MS = 100

for (const peers of SIZES) {
  test(`a list of ${String(peers)} conversations @desktop @perf`, async () => {
    test.setTimeout(300_000)
    // Read by apps/desktop's dev entry, which passes it to the fake's crowd fixture.
    process.env['SESSION_FAKE_CONVERSATIONS'] = String(peers)
    process.env['SESSION_FAKE_HISTORY'] = '1'

    const app = await DesktopApp.launch('perf')
    try {
      await app.startProbe()

      // Cold: the list appearing at all. Everything from boot through hydration, the first
      // conversation_list_replaced, the projection, and the first commit.
      const toList = await app.timeUntilVisible(ELEMENT.conversationList.screen)
      await app.waitForVisible(ELEMENT.conversationList.row(0))
      // On the page's own clock, which is the one a long task's start is on.
      const listShownAt = await app.pageNow()

      // Warm: a tap, and the transcript on screen. This is the number that matches the worry -
      // an interaction, with a fully populated store behind it.
      const start = Date.now()
      await app.tap(ELEMENT.conversationList.row(0))
      const toConversation = await app.timeUntilVisible(ELEMENT.conversation.screen)
      void start

      // Whether the renderer kept up afterwards. 60 over a second is a clean idle.
      const fps = await app.countFrames(1_000)

      const tasks = await app.readLongTasks()
      // Recorded before anything is asserted, so the sweep below runs whatever this size does.
      rows.push({
        peers,
        toList,
        toConversation,
        longTasks: tasks.length,
        worstTask: tasks.reduce((worst, t) => Math.max(worst, t.duration), 0),
        fps,
      })

      // A long task is over 50ms of blocked main thread - a threshold, not a duration, so this
      // means the same thing on a fast laptop and a slow runner. Once the list is on screen there
      // must be none: before the lists were windowed this was 2 at five thousand with a worst of
      // 879ms, and the interaction after it is the thing a person feels.
      const startup = tasks.filter((t) => t.start < listShownAt)
      const afterwards = tasks.filter((t) => t.start >= listShownAt)
      expect(
        afterwards.map((t) => `${t.duration.toFixed(0)}ms`),
        'the main thread must not block for over 50ms once the list is up',
      ).toEqual([])
      expect(startup.length, 'the first render may block the main thread once').toBeLessThan(2)
      expect(
        startup
          .filter((t) => t.duration > STARTUP_BUDGET_MS)
          .map((t) => `${t.duration.toFixed(0)}ms`),
        `the first render must not block for over ${String(STARTUP_BUDGET_MS)}ms`,
      ).toEqual([])
    } finally {
      await app.close()
      delete process.env['SESSION_FAKE_CONVERSATIONS']
      delete process.env['SESSION_FAKE_HISTORY']
    }
  })
}

/**
 * The property the windowing bought, asserted as a ratio so it survives a change of machine.
 *
 * Fifty times the rows should cost about the same, because only a screenful is ever mounted.
 * Measured on the branch before the fix this was 18x - 59 ms at a hundred rows against 1,059 ms
 * at five thousand - so a bound of 3x is far below the regression and far above the noise.
 */
test('the list appears in time that does not grow with the list @desktop @perf', () => {
  const smallest = rows[0]
  const largest = rows[rows.length - 1]
  if (!smallest || !largest || rows.length < 2) {
    throw new Error('the size sweep did not run, so there is nothing to compare')
  }
  const growth = largest.toList / Math.max(smallest.toList, 1)
  expect(
    growth,
    `to-list went from ${smallest.toList.toFixed(0)}ms at ${String(smallest.peers)} rows to ` +
      `${largest.toList.toFixed(0)}ms at ${String(largest.peers)} - it should be flat`,
  ).toBeLessThan(3)
})

test.afterAll(() => {
  if (rows.length === 0) return
  const pad = (value: string, width: number, left = false) =>
    left ? value.padEnd(width) : value.padStart(width)

  const lines = [
    '',
    '== TIER 3: THE WHOLE DESKTOP PATH ==  milliseconds',
    '',
    `${pad('peers', 7, true)}${pad('to list', 10)}${pad('tap to convo', 14)}${pad('long tasks', 12)}${pad('worst task', 12)}${pad('fps', 7)}`,
    `${'-'.repeat(7)}${'-'.repeat(10)}${'-'.repeat(14)}${'-'.repeat(12)}${'-'.repeat(12)}${'-'.repeat(7)}`,
    ...rows.map(
      (r) =>
        `${pad(String(r.peers), 7, true)}${pad(r.toList.toFixed(0), 10)}${pad(r.toConversation.toFixed(0), 14)}${pad(String(r.longTasks), 12)}${pad(r.worstTask.toFixed(0), 12)}${pad(String(r.fps), 7)}`,
    ),
    '',
    '  to list        boot through to the conversation list on screen',
    '  tap to convo   a tap, and the transcript visible - the interaction that matters',
    '  long tasks     main-thread blocks over 50ms; anything above zero is a stall',
    '  worst task     the longest single block',
    '  fps            frames painted in the second after the tap; 60 is a clean idle',
    '',
  ]
  process.stdout.write(`${lines.join('\n')}\n`)
})
