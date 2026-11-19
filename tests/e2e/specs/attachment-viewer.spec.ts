import { expect, test } from '@playwright/test'
import { ELEMENT, type ElementId } from '@session/test-ids'

import { downloadFromRow, openFirstConversation } from '../harness/attachments'
import { DesktopApp } from '../harness/DesktopApp'
import { SEEDED_LIST } from '../harness/fixtures'
import type { ISessionApp } from '../harness/ISessionApp'
import { sessionTest } from '../harness/sessionTest'

/** Fetches the album, the first set with an action, and opens its first picture. */
async function openViewer(app: ISessionApp): Promise<void> {
  await openFirstConversation(app)
  await app.tap(ELEMENT.conversation.attachmentAction)
  await app.waitForVisible(ELEMENT.conversation.autoDownloadPrompt)
  await app.tap(ELEMENT.conversation.autoDownloadNo)
  await app.waitForVisible(ELEMENT.conversation.attachmentImage)
  await app.tap(ELEMENT.conversation.attachmentTile)
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
 * Launched directly rather than through `sessionTest`, because a position is Chromium's layout and
 * `ISessionApp` has no way to ask a device for one.
 */
test('centres the chevrons on the picture @desktop', async () => {
  const app = await DesktopApp.launch('alice')
  try {
    await openViewer(app)
    const centre = async (id: ElementId) => {
      const box = await app.locator(id).first().boundingBox()
      if (box === null) throw new Error(`${id} is not laid out`)
      return box.y + box.height / 2
    }
    const picture = await centre(ELEMENT.conversation.mediaViewerImage)
    const next = await centre(ELEMENT.conversation.mediaViewerNext)
    expect(Math.abs(next - picture)).toBeLessThanOrEqual(1)
  } finally {
    await app.close()
  }
})

/** The arrow keys page through the set as the chevrons do, and stop at its ends. */
test('steps through the set with the arrow keys @desktop', async () => {
  const app = await DesktopApp.launch('alice')
  try {
    await openViewer(app)
    expect(await app.isDisabled(ELEMENT.conversation.mediaViewerPrevious)).toBe(true)

    await app.page.keyboard.press('ArrowRight')
    await expect
      .poll(async () => app.isDisabled(ELEMENT.conversation.mediaViewerPrevious))
      .toBe(false)

    await app.page.keyboard.press('ArrowLeft')
    await expect
      .poll(async () => app.isDisabled(ELEMENT.conversation.mediaViewerPrevious))
      .toBe(true)
    // Already at the start: a further press leaves the viewer open on the same picture.
    await app.page.keyboard.press('ArrowLeft')
    expect(await app.isVisible(ELEMENT.conversation.mediaViewer)).toBe(true)
    expect(await app.isDisabled(ELEMENT.conversation.mediaViewerPrevious)).toBe(true)
  } finally {
    await app.close()
  }
})

/**
 * A picture's row opens it once it is here, as its thumbnail does, and fetches it before. Its
 * control still exports it, so the row is the only thing that changed meaning.
 */
sessionTest({
  title: 'opens a downloaded picture from its row',
  risk: 'medium',
  clients: { alice: 'desktop' },
  run: async ({ alice }) => {
    if (!alice) throw new Error('the harness did not open alice')

    await openFirstConversation(alice)
    const at = await downloadFromRow(alice, SEEDED_LIST[0])

    await alice.tapAt(ELEMENT.conversation.attachmentName, at)
    await alice.waitForVisible(ELEMENT.conversation.mediaViewer)
    await alice.screenshot('attachment-row-opens-viewer-desktop')

    await alice.tap(ELEMENT.conversation.mediaViewerClose)
    await expect
      .poll(async () => alice.isVisible(ELEMENT.conversation.mediaViewer), { timeout: 5_000 })
      .toBe(false)
    expect(await alice.isVisible(ELEMENT.conversation.attachmentExport)).toBe(true)
  },
})

/**
 * A picture the viewer draws only through its rendition opens on "Loading" while libsession makes
 * one, then draws it, and the picture before it in the set is a step back. A hundred times slower,
 * so the rendition is still being made when the viewer is looked at.
 */
sessionTest({
  title: 'opens a picture on its rendition, saying Loading until it is made',
  risk: 'medium',
  clients: { alice: 'desktop' },
  env: { EXPO_PUBLIC_SESSION_FAKE_SLOWDOWN: '100' },
  run: async ({ alice }) => {
    if (!alice) throw new Error('the harness did not open alice')
    const avif = SEEDED_LIST[3]

    await openFirstConversation(alice)
    const at = await downloadFromRow(alice, avif)
    // The viewer pages only through what is here, so the receipt before it is fetched too.
    const names = await alice.readAllText(ELEMENT.conversation.attachmentName)
    await alice.tapAt(ELEMENT.conversation.attachmentName, names.indexOf(SEEDED_LIST[0]))
    await expect
      .poll(async () => alice.count(ELEMENT.conversation.attachmentExport), { timeout: 15_000 })
      .toBe(2)
    await alice.tapAt(ELEMENT.conversation.attachmentName, at)
    await alice.waitForVisible(ELEMENT.conversation.mediaViewer)

    await expect
      .poll(async () => alice.isVisible(ELEMENT.conversation.mediaViewerPreparing))
      .toBe(true)
    await expect
      .poll(async () => alice.isVisible(ELEMENT.conversation.mediaViewerImage), {
        timeout: 15_000,
      })
      .toBe(true)
    expect(await alice.isVisible(ELEMENT.conversation.mediaViewerPreparing)).toBe(false)
    await alice.screenshot('attachment-viewer-rendition-desktop')

    // The receipt comes before it in the set, so only the way back is open.
    expect(await alice.isDisabled(ELEMENT.conversation.mediaViewerNext)).toBe(true)
    await alice.tap(ELEMENT.conversation.mediaViewerPrevious)
    await expect
      .poll(async () => alice.isDisabled(ELEMENT.conversation.mediaViewerPrevious))
      .toBe(true)
    expect(await alice.isDisabled(ELEMENT.conversation.mediaViewerNext)).toBe(false)
  },
})
