import { expect, test } from '@playwright/test'
import { ELEMENT } from '@session/test-ids'

import { openFirstConversation } from '../harness/attachments'
import { DesktopApp } from '../harness/DesktopApp'
import type { ISessionApp } from '../harness/ISessionApp'
import { sessionTest } from '../harness/sessionTest'

/** Fetches the album, the first set with an action, and opens its first picture. */
async function openViewer(app: ISessionApp): Promise<void> {
  await openFirstConversation(app)
  await app.tap(ELEMENT.conversation.attachmentAction)
  await app.waitForVisible(ELEMENT.conversation.autoDownloadPrompt)
  await app.tap(ELEMENT.conversation.autoDownloadNo)
  await app.waitForVisible(ELEMENT.conversation.attachmentImage)
  await app.tap(ELEMENT.conversation.attachmentImage)
  await app.waitForVisible(ELEMENT.conversation.mediaViewer)
}

/**
 * Opening a picture, stepping through its set and closing it again.
 *
 * The chrome is what this is about: on a phone the viewer is drawn edge to edge, and a close
 * button under the status bar is one nobody can press. Desktop has no status bar, so what this
 * run shows is the other half - that keeping the chrome inside the safe area left every control
 * where a pointer can reach it.
 */
sessionTest({
  title: 'opens a picture, steps to the next and closes',
  risk: 'low',
  clients: { alice: 'desktop' },
  run: async ({ alice }) => {
    if (!alice) throw new Error('the harness did not open alice')

    await openViewer(alice)

    expect(await alice.isVisible(ELEMENT.conversation.mediaViewerClose)).toBe(true)
    expect(await alice.isVisible(ELEMENT.conversation.mediaViewerExport)).toBe(true)
    // Previous is disabled only on the first item, so its change is the viewer having moved.
    expect(await alice.isDisabled(ELEMENT.conversation.mediaViewerPrevious)).toBe(true)
    await alice.tap(ELEMENT.conversation.mediaViewerNext)
    await expect
      .poll(async () => alice.isDisabled(ELEMENT.conversation.mediaViewerPrevious))
      .toBe(false)
    await alice.screenshot('attachment-viewer-desktop')

    await alice.tap(ELEMENT.conversation.mediaViewerClose)
    await expect
      .poll(async () => alice.isVisible(ELEMENT.conversation.mediaViewer), { timeout: 5_000 })
      .toBe(false)
  },
})

/**
 * The chevrons sit on the picture's middle, not on the middle of a box that also holds the header.
 *
 * Launched directly rather than through `sessionTest`, because the position is a layout probe and
 * `ISessionApp` has none.
 */
test('centres the chevrons on the picture', async () => {
  const app = await DesktopApp.launch('alice')
  try {
    await openViewer(app)
    const picture = await app.verticalCentre(ELEMENT.conversation.mediaViewerImage)
    const next = await app.verticalCentre(ELEMENT.conversation.mediaViewerNext)
    expect(Math.abs(next - picture)).toBeLessThanOrEqual(1)
  } finally {
    await app.close()
  }
})
