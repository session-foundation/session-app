import { expect, test, type Locator } from '@playwright/test'
import { PENDING_COPY, tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'

import type { DesktopApp } from '../harness/DesktopApp'
import { SEEDED_REPLIES as REPLIES } from '../harness/fixtures'
import { launchLongConversation as launch, messageSaying as row } from '../harness/longConversation'

const CONVERSATION = ELEMENT.conversation
const MENU = ELEMENT.contextMenu

/** Under the half second an animated scroll is given to stop, the click's own time included. */
const HIGHLIGHT_AT_ONCE_MS = 450

const quoteOf = (app: DesktopApp, body: string): Locator =>
  row(app, body).getByTestId(CONVERSATION.messageQuote)

/** On screen, ringed by the landing's highlight, and where the keyboard now is. */
async function expectLandedOn(app: DesktopApp, body: string): Promise<void> {
  const landed = row(app, body)
  await expect(landed).toBeInViewport({ ratio: 1 })
  await expect(landed.getByTestId(CONVERSATION.messageHighlight)).toHaveCount(1)
  await expect(landed).toBeFocused()
}

/** What the page's own elements are read by here: the e2e package is typed without the DOM. */
interface Scrolled {
  parentElement: Scrolled
  scrollHeight: number
  clientHeight: number
  getBoundingClientRect: () => { top: number; bottom: number }
}

/** How far the row's middle is from the middle of the transcript it scrolls in. */
async function offCentrePx(app: DesktopApp, body: string): Promise<number> {
  return row(app, body).evaluate((element: unknown) => {
    const message = element as Scrolled
    let scroller = message.parentElement
    while (scroller.scrollHeight <= scroller.clientHeight + 1) scroller = scroller.parentElement
    const box = scroller.getBoundingClientRect()
    const at = message.getBoundingClientRect()
    return Math.abs((at.top + at.bottom) / 2 - (box.top + box.bottom) / 2)
  })
}

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
    await expect(quoteOf(app, 'Sleep well')).toHaveAccessibleName(`Bob: ${REPLIES.newest}`)
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

test('jumps to an original far above the window, and walks back through the chain @desktop @high-risk', async () => {
  const app = await launch()
  try {
    const button = app.locator(CONVERSATION.scrollToLatest)
    // More than a page above: not in the window at all until the quote is followed.
    await expect(row(app, REPLIES.station)).toHaveCount(0)

    await quoteOf(app, REPLIES.seeYou).click()
    await expectLandedOn(app, REPLIES.station)
    // In the middle of the transcript, not wherever the scroll left over from the last page put it.
    await expect.poll(() => offCentrePx(app, REPLIES.station)).toBeLessThan(16)
    await expect(button).toHaveAccessibleName(PENDING_COPY.messageBackToReply)

    await expect(row(app, REPLIES.meet)).toHaveCount(0)
    await quoteOf(app, REPLIES.station).click()
    await expectLandedOn(app, REPLIES.meet)

    // One jump back per press: to the reply each started from.
    await button.click()
    await expectLandedOn(app, REPLIES.station)
    await expect(button).toHaveAccessibleName(PENDING_COPY.messageBackToReply)
    await button.click()
    await expectLandedOn(app, REPLIES.seeYou)

    // Nothing left to walk back, and the newest message is in reach: no button.
    await expect(button).toHaveCount(0)
    await expect(row(app, REPLIES.newest)).toBeInViewport()
  } finally {
    await app.close()
  }
})

test('only highlights an original already on screen, with no button and nothing to return to @desktop @medium-risk', async () => {
  const app = await launch()
  try {
    const button = app.locator(CONVERSATION.scrollToLatest)
    // The picture it answers is the row above it.
    await expect(row(app, REPLIES.view)).toBeInViewport()
    await quoteOf(app, REPLIES.whereIsThis).click()
    // At once: it can be seen already, so the scroll that brings the rest in is not waited for.
    await expect(row(app, REPLIES.view).getByTestId(CONVERSATION.messageHighlight)).toHaveCount(1, {
      timeout: HIGHLIGHT_AT_ONCE_MS,
    })
    await expect(button).toHaveCount(0)

    // Far enough up for the button: it goes to the newest message, not back to that reply.
    await row(app, REPLIES.newest).hover()
    for (let wheel = 0; wheel < 12; wheel++) await app.page.mouse.wheel(0, -600)
    await expect(button).toHaveAccessibleName(PENDING_COPY.messageScrollToLatest)
  } finally {
    await app.close()
  }
})

test('forgets the way back once the reader is at the newest message again by hand @desktop @medium-risk', async () => {
  const app = await launch()
  try {
    const button = app.locator(CONVERSATION.scrollToLatest)
    await quoteOf(app, REPLIES.seeYou).click()
    await expectLandedOn(app, REPLIES.station)
    await expect(button).toHaveAccessibleName(PENDING_COPY.messageBackToReply)

    // Down by the wheel, through the pages between, until the button goes.
    await row(app, REPLIES.station).hover()
    await expect(async () => {
      await app.page.mouse.wheel(0, 3000)
      await expect(button).toHaveCount(0, { timeout: 500 })
    }).toPass({ timeout: 30_000 })
    await expect(row(app, REPLIES.newest)).toBeInViewport()

    for (let wheel = 0; wheel < 12; wheel++) await app.page.mouse.wheel(0, -600)
    await expect(button).toHaveAccessibleName(PENDING_COPY.messageScrollToLatest)
  } finally {
    await app.close()
  }
})

test('sends from far back, which shows the newest page and forgets the way back @desktop @medium-risk', async () => {
  const app = await launch()
  try {
    await quoteOf(app, REPLIES.seeYou).click()
    await expectLandedOn(app, REPLIES.station)
    await expect(row(app, REPLIES.newest)).toHaveCount(0)

    await app.locator(CONVERSATION.composerInput).click()
    await app.page.keyboard.type('From far back')
    await app.page.keyboard.press('Enter')

    await expect(row(app, 'From far back')).toBeInViewport({ ratio: 1 })
    await expect(row(app, REPLIES.newest)).toBeInViewport({ ratio: 1 })
    await expect(app.locator(CONVERSATION.scrollToLatest)).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('says an original is not found, for one never received and one deleted since @desktop @medium-risk', async () => {
  const app = await launch()
  try {
    const notFound = tr('messageErrorOriginal')
    for (const body of [REPLIES.neverReceived, REPLIES.deletedSince]) {
      const quote = quoteOf(app, body)
      await expect(quote, body).toContainText(notFound)
      await quote.click()
      await expect(app.locator(ELEMENT.toast.item), body).toHaveText(notFound)
      // Nowhere to go: the transcript stays where it was.
      await expect(row(app, body), body).toBeInViewport({ ratio: 1 })
      await app.locator(ELEMENT.toast.close).click()
      await expect(app.locator(ELEMENT.toast.item), body).toHaveCount(0)
    }
    await expect(app.locator(CONVERSATION.scrollToLatest)).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('pages down from the first message to the newest by a fast wheel, without stopping @desktop @high-risk', async () => {
  const app = await launch()
  try {
    await quoteOf(app, REPLIES.seeYou).click()
    await expectLandedOn(app, REPLIES.station)
    await quoteOf(app, REPLIES.station).click()
    await expectLandedOn(app, REPLIES.meet)

    // Faster than a page arrives: each is asked for before the reader reaches it.
    await row(app, REPLIES.meet).hover()
    await expect(async () => {
      for (let wheel = 0; wheel < 5; wheel++) await app.page.mouse.wheel(0, 600)
      await expect(row(app, REPLIES.newest)).toBeInViewport({ timeout: 500 })
    }).toPass({ timeout: 30_000 })
  } finally {
    await app.close()
  }
})
