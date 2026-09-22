import { expect } from '@playwright/test'
import { ELEMENT } from '@session/test-ids'

import { sessionTest } from '../harness/sessionTest'

/**
 * A set longer than the transcript will hold.
 *
 * Eight rows and then a way to the rest, rather than fourteen rows the reader has to scroll past
 * to reach whatever was said next. The sheet holds the same rows and the same footer, so nothing
 * is only reachable from one of the two.
 */
sessionTest({
  title: 'moves a long set of attachments into a sheet',
  risk: 'low',
  clients: { alice: 'desktop' },
  run: async ({ alice }) => {
    if (!alice) throw new Error('the harness did not open alice')

    await alice.waitForVisible(ELEMENT.conversationList.screen)
    await alice.tap(ELEMENT.conversationList.row(0))
    await alice.waitForVisible(ELEMENT.conversation.screen)

    // Two rows from the mixed message and eight of the thirteen from the long one. The five the
    // transcript is not drawing are what the sheet is for.
    await expect
      .poll(async () => alice.count(ELEMENT.conversation.attachmentName), { timeout: 10_000 })
      .toBe(10)
    expect(await alice.count(ELEMENT.conversation.attachmentShowAll)).toBe(1)

    await alice.tap(ELEMENT.conversation.attachmentShowAll)
    await alice.waitForVisible(ELEMENT.conversation.attachmentSheet)

    // Every one of them, and the footer that acts on all of them.
    await expect
      .poll(async () => alice.count(ELEMENT.conversation.attachmentName), { timeout: 5_000 })
      .toBe(23)
    expect(await alice.isVisible(ELEMENT.conversation.attachmentFooter)).toBe(true)

    await alice.screenshot('attachment-sheet-desktop')

    await alice.tap(ELEMENT.conversation.attachmentSheetClose)
    await expect
      .poll(async () => alice.isVisible(ELEMENT.conversation.attachmentSheet), { timeout: 5_000 })
      .toBe(false)
  },
})
