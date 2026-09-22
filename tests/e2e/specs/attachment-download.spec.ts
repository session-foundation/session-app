import { expect } from '@playwright/test'
import { ELEMENT } from '@session/test-ids'

import { sessionTest } from '../harness/sessionTest'

/**
 * Fetching an attachment, and being asked once what to do about the rest.
 *
 * The states are what this asserts, not the animation: the fake drains its whole clock on every
 * tick, so a download there is over before a screenshot could catch the bar. The ordering of the
 * reports - a start with no size, exactly one result - is asserted where it can be seen, in the
 * reducer tests and the contract suite.
 */
sessionTest({
  title: 'downloads an attachment and asks what to do with the rest',
  risk: 'medium',
  clients: { alice: 'desktop' },
  run: async ({ alice }) => {
    if (!alice) throw new Error('the harness did not open alice')

    await alice.waitForVisible(ELEMENT.conversationList.screen)
    await alice.tap(ELEMENT.conversationList.row(0))
    await alice.waitForVisible(ELEMENT.conversation.screen)

    // The pictures fetch themselves as they draw, through the media scheme the main process
    // serves - no tap, and no prompt, because nobody asked for them by hand.
    expect(await alice.imageLoaded(ELEMENT.conversation.attachmentImage)).toBe(true)

    const names = await alice.readAllText(ELEMENT.conversation.attachmentName)
    expect(names).toContain('itinerary.pdf')

    await alice.tap(ELEMENT.conversation.attachmentDownload)

    // Asked on the first attachment fetched in a conversation and never again, because the
    // answer - `no` included - is what records that the question was put.
    await alice.waitForVisible(ELEMENT.conversation.autoDownloadPrompt)
    await alice.tap(ELEMENT.conversation.autoDownloadNo)
    expect(await alice.isVisible(ELEMENT.conversation.autoDownloadPrompt)).toBe(false)

    // Downloaded is the row offering to save: nothing says so in words, because there is no
    // catalogue key that does.
    await expect
      .poll(async () => alice.isVisible(ELEMENT.conversation.attachmentSave), { timeout: 10_000 })
      .toBe(true)

    // Left and come back. The window is dropped when a screen stops showing it, so the store has
    // nothing to remember this by: what redraws it as downloaded is the page saying so, which is
    // the only thing that can - no event ever announces a file that is simply already here.
    await alice.tap(ELEMENT.conversation.back)
    await alice.tap(ELEMENT.conversationList.row(0))
    await alice.waitForVisible(ELEMENT.conversation.screen)
    await expect
      .poll(async () => alice.isVisible(ELEMENT.conversation.attachmentSave), { timeout: 10_000 })
      .toBe(true)

    await alice.screenshot('attachment-download-desktop')
  },
})
