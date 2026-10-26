import { expect } from '@playwright/test'
import { ELEMENT } from '@session/test-ids'

import { downloadFirstAttachment, openFirstConversation } from '../harness/attachments'
import { SEEDED_LIST } from '../harness/fixtures'
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

    await openFirstConversation(alice)

    // Nothing fetches itself. A tile draws libsession's thumbnail, which is never a download, so
    // only a tap or libsession's own rule on arrival spends data, and unset means nobody has been
    // asked. A short wait rather than the default: this is asserting that something never
    // happens, so the only cost of the timeout is how long the suite sits here.
    expect(
      await alice.imageLoaded(ELEMENT.conversation.attachmentImage, { timeoutMs: 2_000 }),
    ).toBe(false)

    // One plain file puts the whole set in a list, the picture beside it included - so the
    // paperwork message draws two rows rather than a tile with a document hanging off it.
    const names = await alice.readAllText(ELEMENT.conversation.attachmentName)
    expect(names.slice(0, SEEDED_LIST.length)).toEqual(SEEDED_LIST)

    // Asked on the first attachment fetched in a conversation and never again, because the
    // answer - `no` included - is what records that the question was put. Downloaded is the row
    // offering to export: the two verbs tell "the bytes are not here" apart from "the bytes are
    // here and can be written out".
    await downloadFirstAttachment(alice)
    // Polled because the dialog fades out rather than disappearing on the tap.
    await expect
      .poll(async () => alice.isVisible(ELEMENT.conversation.autoDownloadPrompt), {
        timeout: 5_000,
      })
      .toBe(false)

    // Left and come back. The window is dropped when a screen stops showing it, so the store has
    // nothing to remember this by: what redraws it as downloaded is the page saying so, which is
    // the only thing that can - no event ever announces a file that is simply already here.
    // Left by opening another screen in its place: the desktop window shows the list beside the
    // conversation, where there is no back control, and tapping the open row again changes
    // nothing, so neither would unmount it.
    await alice.tap(ELEMENT.conversationList.newConversation)
    await openFirstConversation(alice)
    await expect
      .poll(async () => alice.isVisible(ELEMENT.conversation.attachmentExport), { timeout: 10_000 })
      .toBe(true)

    await alice.screenshot('attachment-download-desktop')
  },
})
