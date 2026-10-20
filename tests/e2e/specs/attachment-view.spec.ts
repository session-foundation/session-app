import { expect, test } from '@playwright/test'
import { ELEMENT } from '@session/test-ids'

import { SEEDED_ALBUM, SEEDED_LIST } from '../harness/fixtures'
import { downloadFirstAttachment, openFirstConversation } from '../harness/attachments'
import { DesktopApp } from '../harness/DesktopApp'
import { sessionTest } from '../harness/sessionTest'

/**
 * Reading a set of photographs as rows, because somebody asked to.
 *
 * Not a failure fallback: nothing has gone wrong here, the set draws perfectly well as an album,
 * and the reader wants the names and the sizes instead.
 *
 * The conversation holds three attachment messages, oldest first: an album of two photographs,
 * which names nothing; a picture and two documents, a list from the start; and a roll with a
 * document in it, also a list. Only the album offers the toggle - with a document in the set the
 * gallery is impossible rather than unwanted. So before the toggle the first names on screen are
 * the picture-and-documents list's, and after it the album's come ahead of them.
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

    await openFirstConversation(alice)

    expect(await alice.count(ELEMENT.conversation.attachmentViewGallery)).toBe(1)

    const before = await alice.readAllText(ELEMENT.conversation.attachmentName)
    expect(before.slice(0, SEEDED_LIST.length)).toEqual(SEEDED_LIST)

    await alice.tap(ELEMENT.conversation.attachmentViewList)
    const expected = [...SEEDED_ALBUM, ...SEEDED_LIST]
    await expect
      .poll(
        async () =>
          (await alice.readAllText(ELEMENT.conversation.attachmentName)).slice(0, expected.length),
        { timeout: 5_000 },
      )
      .toEqual(expected)

    await alice.screenshot('attachment-view-list-desktop')
  },
})

/**
 * A list in a bubble has a width to draw into.
 *
 * A downloaded picture is the row most likely to lose its name, because its thumbnail is what
 * takes the lead column. On a phone a list that sized itself gave the names and the footer's total
 * no width at all; Chromium lays the same tree out wider, so that half is held by
 * `attachmentWidth.contract.test.ts` in screens, and this is the desktop half.
 *
 * Launched directly rather than through `sessionTest`, because the clip check is a layout probe
 * and `ISessionApp` has none.
 */
test('draws every name and the total in full in a list', async () => {
  const app = await DesktopApp.launch('alice')
  try {
    await openFirstConversation(app)
    await downloadFirstAttachment(app)
    await app.tap(ELEMENT.conversation.attachmentViewList)

    await expect
      .poll(async () => (await app.readAllText(ELEMENT.conversation.attachmentName)).length, {
        timeout: 5_000,
      })
      .toBeGreaterThanOrEqual(SEEDED_ALBUM.length + SEEDED_LIST.length)
    expect(await app.clipped(ELEMENT.conversation.attachmentName)).not.toContain(true)
    expect(await app.clipped(ELEMENT.conversation.attachmentState)).not.toContain(true)

    await app.screenshot('attachment-view-list-names-desktop')
  } finally {
    await app.close()
  }
})
