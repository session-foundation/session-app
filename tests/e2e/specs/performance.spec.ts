import { test } from '@playwright/test'
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

      // Warm: a tap, and the transcript on screen. This is the number that matches the worry -
      // an interaction, with a fully populated store behind it.
      const start = Date.now()
      await app.tap(ELEMENT.conversationList.row(0))
      const toConversation = await app.timeUntilVisible(ELEMENT.conversation.screen)
      void start

      // Whether the renderer kept up afterwards. 60 over a second is a clean idle.
      const fps = await app.countFrames(1_000)

      const tasks = await app.readLongTasks()
      rows.push({
        peers,
        toList,
        toConversation,
        longTasks: tasks.length,
        worstTask: tasks.reduce((worst, t) => Math.max(worst, t.duration), 0),
        fps,
      })
    } finally {
      await app.close()
      delete process.env['SESSION_FAKE_CONVERSATIONS']
      delete process.env['SESSION_FAKE_HISTORY']
    }
  })
}

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
