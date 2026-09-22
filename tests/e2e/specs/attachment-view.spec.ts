import { expect } from '@playwright/test'
import { ELEMENT } from '@session/test-ids'

import { sessionTest } from '../harness/sessionTest'

/**
 * Reading a set of photographs as rows, because somebody asked to.
 *
 * Not a failure fallback: nothing has gone wrong here, the set draws perfectly well as an album,
 * and the reader wants the names and the sizes instead. The message with a document in it has no
 * toggle at all, because there the gallery is impossible rather than unwanted.
 *
 * That the choice survives the row being unmounted is not asserted here: the transcript is a
 * windowed list and scrolling one far enough to recycle a row is the kind of step that passes
 * for the wrong reason. `ConversationScreen` holding the record rather than the row is the
 * durable statement of it.
 */
sessionTest({
  title: 'reads a gallery as a list when asked',
  risk: 'low',
  clients: { alice: 'desktop' },
  run: async ({ alice }) => {
    if (!alice) throw new Error('the harness did not open alice')

    await alice.waitForVisible(ELEMENT.conversationList.screen)
    await alice.tap(ELEMENT.conversationList.row(0))
    await alice.waitForVisible(ELEMENT.conversation.screen)

    // One toggle in the transcript: the photographs. The message carrying a document is already
    // a list and has nothing to offer.
    expect(await alice.count(ELEMENT.conversation.attachmentViewGallery)).toBe(1)

    // The album names nothing, so a name appearing is the set having become rows.
    const before = await alice.readAllText(ELEMENT.conversation.attachmentName)
    expect(before.slice(0, 2)).toEqual(['receipt.jpg', 'itinerary.pdf'])

    await alice.tap(ELEMENT.conversation.attachmentViewList)
    await expect
      .poll(
        async () => (await alice.readAllText(ELEMENT.conversation.attachmentName)).slice(0, 4),
        { timeout: 5_000 },
      )
      .toEqual(['harbour.jpg', 'ferry.png', 'receipt.jpg', 'itinerary.pdf'])

    await alice.screenshot('attachment-view-list-desktop')
  },
})
