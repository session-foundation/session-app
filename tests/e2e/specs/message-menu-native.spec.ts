import { expect, test } from '@playwright/test'
import { ALBUM_TILE_ID, ATTACHMENT_ROW_IDS } from '@session/expectations'
import { tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'

import { openFirstConversation } from '../harness/attachments'
import { MobileApp, type MobilePlatform } from '../harness/MobileApp'

const MOBILE_PLATFORMS: readonly MobilePlatform[] = ['android', 'ios']
const MENU = ELEMENT.contextMenu
/** The modal's dismissal, on a slow emulator. */
const CLOSE_MS = 5_000

/** Launched directly, because a long press is a gesture `ISessionApp` does not offer. */
for (const platform of MOBILE_PLATFORMS) {
  test(`opens a message’s menu on a long press, and closes it from a row @${platform} @medium-risk`, async () => {
    const app = await MobileApp.launch(platform, 'alice')
    try {
      await openFirstConversation(app)
      await app.longPress(ELEMENT.conversation.messageBody)
      await app.waitForVisible(MENU.menu)
      expect(await app.readText(MENU.item('copy'))).toBe(tr('copy'))
      expect(await app.isDisabled(MENU.item('reply'))).toBe(false)
      expect(await app.isDisabled(MENU.item('delete'))).toBe(true)

      await app.tap(MENU.item('copy'))
      await expect.poll(() => app.isVisible(MENU.menu), { timeout: CLOSE_MS }).toBe(false)
    } finally {
      await app.close()
    }
  })
}

/** How far beside the menu a tap lands to reach only its backdrop. */
const BESIDE_PX = 8

/** Taps the backdrop just beside the open menu, on whichever side has room. */
async function tapBesideMenu(app: MobileApp): Promise<void> {
  const menu = await app.frame(MENU.menu)
  if (menu === null) throw new Error('the menu is not open')
  const x = menu.x > 2 * BESIDE_PX ? menu.x - BESIDE_PX : menu.x + menu.width + BESIDE_PX
  await app.tapPoint(x, menu.y + menu.height / 2)
}

for (const platform of MOBILE_PLATFORMS) {
  test(`opens a message’s menu on a long press of its attachments, without opening them @${platform} @medium-risk`, async () => {
    const app = await MobileApp.launch(platform, 'alice')
    try {
      await openFirstConversation(app)
      for (const part of [ALBUM_TILE_ID, ATTACHMENT_ROW_IDS.row, ATTACHMENT_ROW_IDS.lead]) {
        await app.longPress(part)
        await app.waitForVisible(MENU.menu)
        expect(await app.isVisible(MENU.item('export')), part).toBe(true)
        expect(await app.isVisible(ELEMENT.conversation.mediaViewer), part).toBe(false)
        await tapBesideMenu(app)
        await expect.poll(() => app.isVisible(MENU.menu), { timeout: CLOSE_MS }).toBe(false)
      }
    } finally {
      await app.close()
    }
  })
}

/** The index of the lowest message body that ends above the composer. */
async function lowestOnScreen(app: MobileApp): Promise<number> {
  const composer = await app.frame(ELEMENT.conversation.composerInput)
  if (composer === null) throw new Error('the composer is not on screen')
  const count = await app.count(ELEMENT.conversation.messageBody)
  for (let at = count - 1; at >= 0; at--) {
    const body = await app.frame(ELEMENT.conversation.messageBody, at)
    if (body !== null && body.y + body.height < composer.y) return at
  }
  throw new Error('no message is on screen')
}

for (const platform of MOBILE_PLATFORMS) {
  test(`closes a message’s menu on a tap just below it @${platform} @medium-risk`, async () => {
    const app = await MobileApp.launch(platform, 'alice')
    try {
      await openFirstConversation(app)
      // The lowest message on screen, so its menu opens above the finger. iOS's tree also holds
      // rows the list keeps rendered below the composer, off screen.
      await app.longPress(ELEMENT.conversation.messageBody, await lowestOnScreen(app))
      await app.waitForVisible(MENU.menu)
      const menu = await app.frame(MENU.menu)
      if (menu === null) throw new Error('the menu is not open')
      await app.tapPoint(menu.x + menu.width / 2, menu.y + menu.height + BESIDE_PX)
      await expect.poll(() => app.isVisible(MENU.menu), { timeout: CLOSE_MS }).toBe(false)
    } finally {
      await app.close()
    }
  })
}
