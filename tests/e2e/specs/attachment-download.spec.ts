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

    // Nothing fetches itself. Resolving a media url *is* a download - the url is the request -
    // so a tile handed one has spent somebody's data before anyone was asked, and unset means
    // nobody has been. A short wait rather than the default: this is asserting that something
    // never happens, so the only cost of the timeout is how long the suite sits here.
    expect(
      await alice.imageLoaded(ELEMENT.conversation.attachmentImage, { timeoutMs: 2_000 }),
    ).toBe(false)

    // One plain file puts the whole set in a list, the picture beside it included - so the
    // paperwork message draws two rows rather than a tile with a document hanging off it.
    const names = await alice.readAllText(ELEMENT.conversation.attachmentName)
    expect(names.slice(0, 2)).toEqual(['receipt.jpg', 'itinerary.pdf'])

    await alice.tap(ELEMENT.conversation.attachmentDownload)

    // Asked on the first attachment fetched in a conversation and never again, because the
    // answer - `no` included - is what records that the question was put.
    await alice.waitForVisible(ELEMENT.conversation.autoDownloadPrompt)
    await alice.tap(ELEMENT.conversation.autoDownloadNo)
    // Polled rather than read straight after the tap: a dialog fades where the overlay it
    // replaced simply stopped being rendered, so the synchronous read was only ever passing
    // because something else on screen was slow enough to cover the animation.
    await expect
      .poll(async () => alice.isVisible(ELEMENT.conversation.autoDownloadPrompt), {
        timeout: 5_000,
      })
      .toBe(false)

    // Downloaded is the row offering to export: the two verbs are what tells "the bytes are
    // not here" apart from "the bytes are here and can be written out".
    await expect
      .poll(async () => alice.isVisible(ELEMENT.conversation.attachmentExport), { timeout: 10_000 })
      .toBe(true)

    // Left and come back. The window is dropped when a screen stops showing it, so the store has
    // nothing to remember this by: what redraws it as downloaded is the page saying so, which is
    // the only thing that can - no event ever announces a file that is simply already here.
    await alice.tap(ELEMENT.conversation.back)
    await alice.tap(ELEMENT.conversationList.row(0))
    await alice.waitForVisible(ELEMENT.conversation.screen)
    await expect
      .poll(async () => alice.isVisible(ELEMENT.conversation.attachmentExport), { timeout: 10_000 })
      .toBe(true)

    await alice.screenshot('attachment-download-desktop')
  },
})
