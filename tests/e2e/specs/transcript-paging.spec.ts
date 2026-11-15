import { expect, test } from '@playwright/test'
import { PENDING_COPY } from '@session/localization'
import { ELEMENT } from '@session/test-ids'

import { SEEDED_REPLIES as REPLIES } from '../harness/fixtures'
import { launchLongConversation, messageSaying } from '../harness/longConversation'

const CONVERSATION = ELEMENT.conversation

test('opens a long conversation on its newest message @desktop @medium-risk', async () => {
  const app = await launchLongConversation()
  try {
    await expect(messageSaying(app, REPLIES.newest)).toBeInViewport({ ratio: 1 })
    await expect(app.locator(CONVERSATION.scrollToLatest)).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('offers the way to the newest message once it is more than a screen away @desktop @medium-risk', async () => {
  const app = await launchLongConversation()
  try {
    const button = app.locator(CONVERSATION.scrollToLatest)
    await messageSaying(app, REPLIES.newest).hover()
    // Past the page it opened on: older pages are read in as the start comes into reach.
    for (let wheel = 0; wheel < 12; wheel++) await app.page.mouse.wheel(0, -600)
    await expect(button).toHaveAccessibleName(PENDING_COPY.messageScrollToLatest)
    await expect(messageSaying(app, REPLIES.newest)).not.toBeInViewport()

    await button.click()
    await expect(messageSaying(app, REPLIES.newest)).toBeInViewport({ ratio: 1 })
    await expect(button).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('keeps its place as older pages arrive above, one page per reach of the start @desktop @high-risk', async () => {
  const app = await launchLongConversation()
  try {
    const STEP_PX = 120
    await messageSaying(app, REPLIES.newest).hover()
    // Picks the row at the middle of the window; then says how far that same row has moved.
    // In the page's own script: the e2e package is typed without the DOM.
    const pickRow = () =>
      app.page.evaluate(`{
        const rows = [...document.querySelectorAll('[data-testid^="message-row-"]')]
        const row = rows.find((each) => each.getBoundingClientRect().bottom > innerHeight / 2)
        Object.assign(window, { pickedRow: row, pickedTop: row.getBoundingClientRect().top })
      }`)
    const movedPx = (): Promise<number | null> =>
      app.page.evaluate(
        'pickedRow.isConnected ? pickedRow.getBoundingClientRect().top - pickedTop : null',
      )
    // Through three pages: each step moves what is on screen by the step and no further.
    for (let step = 0; step < 40; step++) {
      await pickRow()
      await app.page.mouse.wheel(0, -STEP_PX)
      await expect
        .poll(movedPx, { message: `step ${step}`, timeout: 2000 })
        .toBeCloseTo(STEP_PX, -1)
      // A page that arrives late must leave it there.
      await app.page.waitForTimeout(100)
      expect(await movedPx(), `step ${step}, settled`).toBeCloseTo(STEP_PX, -1)
    }
    await expect(messageSaying(app, REPLIES.meet)).toHaveCount(0)
  } finally {
    await app.close()
  }
})
