import { expect, test } from '@playwright/test'
import { ALBUM_TILE_ID, ATTACHMENT_ROW_IDS } from '@session/expectations'
import { tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'

import { openFirstConversation } from '../harness/attachments'
import { DesktopApp } from '../harness/DesktopApp'

const MENU = ELEMENT.contextMenu
/** How far into the message the right-click lands, from its top-left corner. */
const INTO_BODY_PX = 6
/** Sub-pixel rounding between the pointer and the menu's box. */
const SLACK_PX = 1

/**
 * Launched directly rather than through `sessionTest`, because a right-click and where it lands
 * are reached through Playwright, which `ISessionApp` does not offer.
 */
test('opens a message’s menu at the pointer on a right-click, and closes it with Escape @desktop @medium-risk', async () => {
  const app = await DesktopApp.launch('alice')
  try {
    await openFirstConversation(app)
    const body = app.locator(ELEMENT.conversation.messageBody).first()
    const box = await body.boundingBox()
    if (box === null) throw new Error('the first message body is not drawn')
    const x = box.x + INTO_BODY_PX
    const y = box.y + INTO_BODY_PX
    await app.page.mouse.click(x, y, { button: 'right' })

    const menu = app.locator(MENU.menu)
    await expect(menu).toBeVisible()
    // A corner of the menu is under the pointer: which one depends on the room each way, and an
    // outgoing message sits by the window's trailing edge.
    const placed = await menu.boundingBox()
    if (placed === null) throw new Error('the menu is not drawn')
    const near = (edges: number[], at: number) =>
      edges.some((edge) => Math.abs(edge - at) <= SLACK_PX)
    expect(near([placed.x, placed.x + placed.width], x), JSON.stringify({ placed, x })).toBe(true)
    expect(near([placed.y, placed.y + placed.height], y), JSON.stringify({ placed, y })).toBe(true)

    await expect(menu).toHaveAttribute('role', 'menu')
    await expect(menu).toHaveAttribute('aria-label', tr('message'))
    await expect(app.locator(MENU.item('copy'))).toHaveText(tr('copy'))
    await expect(app.locator(MENU.item('reply'))).toHaveText(tr('reply'))
    await expect(app.locator(MENU.item('delete'))).toHaveAttribute('aria-disabled', 'true')

    // Opened by a pointer, no row is focused until an arrow key asks for one.
    await app.page.keyboard.press('ArrowDown')
    await expect(app.locator(MENU.item('reply'))).toBeFocused()

    await app.page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('copies a message’s text from its menu @desktop @medium-risk', async () => {
  const app = await DesktopApp.launch('alice')
  try {
    await openFirstConversation(app)
    const body = app.locator(ELEMENT.conversation.messageBody).first()
    const text = await body.innerText()
    await body.click({ button: 'right' })
    await app.locator(MENU.item('copy')).click()
    await expect(app.locator(MENU.menu)).toHaveCount(0)
    expect(await app.readClipboard()).toBe(text)
  } finally {
    await app.close()
  }
})

test('opens a message’s menu from its attachments too, without doing their own press @desktop @medium-risk', async () => {
  const app = await DesktopApp.launch('alice')
  try {
    await openFirstConversation(app)
    for (const part of [ALBUM_TILE_ID, ATTACHMENT_ROW_IDS.row, ATTACHMENT_ROW_IDS.lead]) {
      await app.locator(part).first().click({ button: 'right' })
      await expect(app.locator(MENU.menu), part).toBeVisible()
      await expect(app.locator(MENU.item('export')), part).toBeVisible()
      await app.page.keyboard.press('Escape')
      await expect(app.locator(MENU.menu), part).toHaveCount(0)
      await expect(app.locator(ELEMENT.conversation.mediaViewer), part).toHaveCount(0)
    }
  } finally {
    await app.close()
  }
})

test('moves the menu to another message on a right-click there @desktop @medium-risk', async () => {
  const app = await DesktopApp.launch('alice')
  try {
    await openFirstConversation(app)
    const bodies = app.locator(ELEMENT.conversation.messageBody)
    await bodies.first().click({ button: 'right' })
    await expect(app.locator(MENU.menu)).toBeVisible()

    // By position: the menu's backdrop covers the message, which is what this is about.
    const other = bodies.nth(1)
    const text = await other.innerText()
    const box = await other.boundingBox()
    if (box === null) throw new Error('the second message body is not drawn')
    await app.page.mouse.click(box.x + INTO_BODY_PX, box.y + INTO_BODY_PX, { button: 'right' })
    await expect(app.locator(MENU.menu)).toHaveCount(1)
    await app.locator(MENU.item('copy')).click()
    await expect(app.locator(MENU.menu)).toHaveCount(0)
    expect(await app.readClipboard()).toBe(text)
  } finally {
    await app.close()
  }
})
