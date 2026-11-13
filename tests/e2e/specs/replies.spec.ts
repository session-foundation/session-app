import { expect, test, type Locator } from '@playwright/test'
import { tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'

import type { DesktopApp } from '../harness/DesktopApp'
import { SEEDED_REPLIES as REPLIES } from '../harness/fixtures'
import { launchLongConversation as launch, messageSaying as row } from '../harness/longConversation'

const CONVERSATION = ELEMENT.conversation
const MENU = ELEMENT.contextMenu

const quoteOf = (app: DesktopApp, body: string): Locator =>
  row(app, body).getByTestId(CONVERSATION.messageQuote)

test('replies from the menu, and the sent message quotes what it answers @desktop @high-risk', async () => {
  const app = await launch()
  try {
    await row(app, REPLIES.newest).getByTestId(CONVERSATION.messageBody).click({ button: 'right' })
    await expect(app.locator(MENU.item('reply'))).toHaveText(tr('reply'))
    await app.locator(MENU.item('reply')).click()

    const bar = app.locator(CONVERSATION.composerReply)
    await expect(bar).toContainText(tr('messageReplyingTo'))
    await expect(bar).toContainText('Bob')
    await expect(bar).toContainText(REPLIES.newest)
    // Starting a reply puts the caret in the composer.
    await expect(app.locator(CONVERSATION.composerInput)).toBeFocused()

    await app.page.keyboard.type('Sleep well')
    await app.page.keyboard.press('Enter')

    await expect(bar).toHaveCount(0)
    await expect(quoteOf(app, 'Sleep well')).toContainText(REPLIES.newest)
    await expect(row(app, 'Sleep well')).toBeInViewport({ ratio: 1 })
  } finally {
    await app.close()
  }
})

test('starts a reply with a double-click, and stops with Escape or the X, keeping the draft @desktop @medium-risk', async () => {
  const app = await launch()
  try {
    const bar = app.locator(CONVERSATION.composerReply)
    const input = app.locator(CONVERSATION.composerInput)

    await row(app, REPLIES.newest).dblclick()
    await expect(bar).toContainText(REPLIES.newest)
    // The double-click replied instead of selecting the word under it.
    expect(await app.page.evaluate('String(getSelection())')).toBe('')
    await app.page.keyboard.type('half a thought')
    await app.page.keyboard.press('Escape')
    await expect(bar).toHaveCount(0)
    await expect(input).toHaveValue('half a thought')

    // A reply to another message replaces the first.
    await row(app, REPLIES.newest).dblclick()
    await row(app, REPLIES.deletedSince).dblclick()
    await expect(bar).toContainText(REPLIES.deletedSince)
    await app.locator(CONVERSATION.composerReplyClose).click()
    await expect(bar).toHaveCount(0)
    await expect(input).toHaveValue('half a thought')
  } finally {
    await app.close()
  }
})

test('draws an original as not found, for one never received and one deleted since @desktop @medium-risk', async () => {
  const app = await launch()
  try {
    for (const body of [REPLIES.neverReceived, REPLIES.deletedSince])
      await expect(quoteOf(app, body), body).toContainText(tr('messageErrorOriginal'))
  } finally {
    await app.close()
  }
})
