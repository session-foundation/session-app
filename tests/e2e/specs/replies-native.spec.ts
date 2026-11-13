import { expect, test } from '@playwright/test'
import { tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'

import { openFirstConversation } from '../harness/attachments'
import { MobileApp, type MobilePlatform } from '../harness/MobileApp'

const MOBILE_PLATFORMS: readonly MobilePlatform[] = ['android', 'ios']
const CONVERSATION = ELEMENT.conversation
const MENU = ELEMENT.contextMenu
/** A modal's dismissal and a window's read, on a slow emulator. */
const SETTLE_MS = 10_000
/** Past the swipe's threshold, towards the leading edge of a left-to-right layout. */
const SWIPE_TO_REPLY = -140
/** Short of it: the row springs back and nothing starts. */
const SWIPE_SHORT = -30

/** Launched directly: a swipe and a long press are gestures `ISessionApp` does not offer. */
for (const platform of MOBILE_PLATFORMS) {
  test(`starts a reply on a swipe, which opens no menu, and stops from the X @${platform} @high-risk`, async () => {
    const app = await MobileApp.launch(platform, 'alice')
    try {
      await openFirstConversation(app)

      await app.swipeAcross(CONVERSATION.messageBody, SWIPE_SHORT)
      expect(await app.isVisible(CONVERSATION.composerReply)).toBe(false)

      await app.swipeAcross(CONVERSATION.messageBody, SWIPE_TO_REPLY)
      await app.waitForVisible(CONVERSATION.composerReply)
      expect(await app.isVisible(MENU.menu)).toBe(false)

      await app.tap(CONVERSATION.composerReplyClose)
      await expect
        .poll(() => app.isVisible(CONVERSATION.composerReply), { timeout: SETTLE_MS })
        .toBe(false)
    } finally {
      await app.close()
    }
  })

  test(`opens the menu on a long press, which starts no reply, and replies from it @${platform} @high-risk`, async () => {
    const app = await MobileApp.launch(platform, 'alice')
    try {
      await openFirstConversation(app)
      const quotesBefore = await app.count(CONVERSATION.messageQuote)

      await app.longPress(CONVERSATION.messageBody)
      await app.waitForVisible(MENU.menu)
      expect(await app.isVisible(CONVERSATION.composerReply)).toBe(false)
      expect(await app.readText(MENU.item('reply'))).toBe(tr('reply'))

      await app.tap(MENU.item('reply'))
      await app.waitForVisible(CONVERSATION.composerReply)
      await expect.poll(() => app.isVisible(MENU.menu), { timeout: SETTLE_MS }).toBe(false)

      await app.type(CONVERSATION.composerInput, 'On my way')
      await app.tap(CONVERSATION.sendButton)
      await expect
        .poll(() => app.isVisible(CONVERSATION.composerReply), { timeout: SETTLE_MS })
        .toBe(false)
      // The sent message heads its bubble with what it answers.
      await expect
        .poll(() => app.count(CONVERSATION.messageQuote), { timeout: SETTLE_MS })
        .toBe(quotesBefore + 1)
      expect(await app.readAllText(CONVERSATION.messageBody)).toContain('On my way')
    } finally {
      await app.close()
    }
  })
}
