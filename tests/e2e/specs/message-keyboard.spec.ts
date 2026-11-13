import { expect, test } from '@playwright/test'
import { MESSAGE_FRAME } from '@session/expectations'
import { ELEMENT } from '@session/test-ids'
import { SPACING } from '@session/theme-tokens'

import { openFirstConversation } from '../harness/attachments'
import { DesktopApp } from '../harness/DesktopApp'

const CONVERSATION = ELEMENT.conversation
const MENU = ELEMENT.contextMenu
const ROW = CONVERSATION.messageRow
/** The `transcripts` fixture: five messages in Bob's and Charlie's, the third carrying a file. */
const NEWEST = 4
const WITH_FILE = 2
/** Dracula's, long enough to scroll. */
const LONG_NEWEST = 34
const LONG_ROW = 2
/** Between a message and a menu opened against it. */
const MENU_GAP_PX = SPACING['2xs']
const SLACK_PX = 1

const TRANSCRIPTS = { env: { EXPO_PUBLIC_SESSION_FAKE_FIXTURE: 'transcripts' } }

async function launch(): Promise<DesktopApp> {
  const app = await DesktopApp.launch('alice', TRANSCRIPTS)
  await openFirstConversation(app)
  await expect(app.locator(CONVERSATION.headerName)).toHaveText('Bob')
  return app
}

/** Where focus is, waited for: closing a menu hands focus back once its modal has gone. */
async function expectFocusOn(app: DesktopApp, id: string): Promise<void> {
  await expect.poll(() => app.focusedStop()).toEqual({ testID: id, at: 0 })
}

async function expectMessageFocused(app: DesktopApp, index: number): Promise<void> {
  await expectFocusOn(app, ROW(index))
  expect(await app.describe(ROW(index))).toMatchObject(MESSAGE_FRAME.desktop)
}

/** Into the transcript from the control after it, which every layout has. */
async function enterFromComposer(app: DesktopApp): Promise<void> {
  await app.locator(CONVERSATION.attachButton).focus()
  await app.page.keyboard.press('Shift+Tab')
}

/** Focused as the keyboard focuses, with its ring, rather than by the pointer. */
async function expectRing(app: DesktopApp, index: number): Promise<void> {
  await expectMessageFocused(app, index)
  await expect(app.locator(ROW(index)).and(app.page.locator(':focus-visible'))).toHaveCount(1)
}

async function press(app: DesktopApp, key: string, times = 1): Promise<void> {
  for (let i = 0; i < times; i++) await app.page.keyboard.press(key)
}

/** The menu hangs against the message, below it or above it, and across it. */
async function expectMenuAgainst(app: DesktopApp, index: number): Promise<void> {
  const menu = app.locator(MENU.menu)
  await expect(menu).toBeVisible()
  const placed = await menu.boundingBox()
  const message = await app.locator(ROW(index)).boundingBox()
  if (placed === null || message === null) throw new Error('the menu or the message is not drawn')
  const where = JSON.stringify({ placed, message })
  const below = Math.abs(placed.y - (message.y + message.height + MENU_GAP_PX)) <= SLACK_PX
  const above = Math.abs(placed.y + placed.height - (message.y - MENU_GAP_PX)) <= SLACK_PX
  expect(below || above, where).toBe(true)
  const across = placed.x < message.x + message.width && placed.x + placed.width > message.x
  expect(across, where).toBe(true)
}

/**
 * Launched directly rather than through `sessionTest`: Tab, the arrow keys and where focus lands
 * are the desktop's alone, and reached through Playwright.
 */
test('moves through a transcript as one tab stop, Up and Down between its messages @desktop @medium-risk', async () => {
  const app = await launch()
  try {
    await enterFromComposer(app)
    await expectMessageFocused(app, NEWEST)
    for (let index = 0; index < NEWEST; index++) {
      await expect(app.locator(ROW(index))).toHaveAttribute('tabindex', '-1')
    }
    // A message's own controls are stops only while it is the list's.
    await expect(app.locator(CONVERSATION.attachmentAction)).toHaveAttribute('tabindex', '-1')

    await press(app, 'Tab')
    await expectFocusOn(app, CONVERSATION.attachButton)

    await press(app, 'Shift+Tab')
    await expectMessageFocused(app, NEWEST)
    await press(app, 'ArrowUp', NEWEST - WITH_FILE)
    await expectMessageFocused(app, WITH_FILE)
    await expect(app.locator(ROW(WITH_FILE))).toBeInViewport()

    // Tab goes through the focused message's control, then out of the list.
    await press(app, 'Tab')
    await expectFocusOn(app, CONVERSATION.attachmentAction)
    await press(app, 'Tab')
    await expectFocusOn(app, CONVERSATION.attachButton)

    // Back in on the message last focused, through its control.
    await press(app, 'Shift+Tab', 2)
    await expectMessageFocused(app, WITH_FILE)

    // No wrapping at either end.
    await press(app, 'ArrowUp', WITH_FILE + 1)
    await expectMessageFocused(app, 0)
    await press(app, 'ArrowDown', NEWEST + 1)
    await expectMessageFocused(app, NEWEST)

    // From a control inside a message, Up and Down move for the message.
    await press(app, 'ArrowUp', NEWEST - WITH_FILE)
    await press(app, 'Tab')
    await expectFocusOn(app, CONVERSATION.attachmentAction)
    await press(app, 'ArrowUp')
    await expectMessageFocused(app, WITH_FILE - 1)

    // Another conversation starts again on its newest message.
    await app.tap(ELEMENT.conversationList.row(1))
    await expect(app.locator(CONVERSATION.headerName)).toHaveText('Charlie')
    await enterFromComposer(app)
    await expectMessageFocused(app, NEWEST)
  } finally {
    await app.close()
  }
})

test('opens the focused message’s menu from the keyboard, against the message, and returns focus to it @desktop @medium-risk', async () => {
  const app = await launch()
  try {
    // Away from every message, so a menu opened at the pointer would be nowhere near one.
    await app.page.mouse.move(0, 0)
    await enterFromComposer(app)
    await press(app, 'ArrowUp')
    await expectMessageFocused(app, NEWEST - 1)

    await press(app, 'Enter')
    await expectMenuAgainst(app, NEWEST - 1)
    // Opened by the keyboard, the first row has focus.
    await expectFocusOn(app, MENU.item('reply'))
    await press(app, 'Escape')
    await expect(app.locator(MENU.menu)).toHaveCount(0)
    await expectMessageFocused(app, NEWEST - 1)

    await press(app, 'Space')
    await expectMenuAgainst(app, NEWEST - 1)
    // Tab closes the menu as Escape does.
    await press(app, 'Tab')
    await expect(app.locator(MENU.menu)).toHaveCount(0)
    await expectMessageFocused(app, NEWEST - 1)

    // From a control inside a message, the menu is the message's, and focus goes back to the
    // control.
    await press(app, 'ArrowUp', NEWEST - 1 - WITH_FILE)
    await press(app, 'Tab')
    await expectFocusOn(app, CONVERSATION.attachmentAction)
    await press(app, 'Shift+F10')
    await expectMenuAgainst(app, WITH_FILE)
    await press(app, 'Escape')
    await expectFocusOn(app, CONVERSATION.attachmentAction)
    // The platform's Menu key works as well, though the list teaches Enter.
    await press(app, 'ContextMenu')
    await expectMenuAgainst(app, WITH_FILE)
    await press(app, 'Escape')
    // Enter inside the message is the control's, not the menu's.
    await press(app, 'Enter')
    await expect(app.locator(MENU.menu)).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('enters a transcript on a message on screen, or the one a click chose @desktop @medium-risk', async () => {
  const app = await launch()
  try {
    await app.tap(ELEMENT.conversationList.row(LONG_ROW))
    await expect(app.locator(CONVERSATION.headerName)).toHaveText('Dracula')
    // Reaching the start reads the rest of the history in above it, which renumbers the rows.
    await app.scrollToStart(CONVERSATION.screen)
    await expect(app.locator(ROW(LONG_NEWEST))).toHaveCount(1)
    await app.locator(ROW(0)).scrollIntoViewIfNeeded()
    await expect(app.locator(ROW(LONG_NEWEST))).not.toBeInViewport()

    // This far from the newest message, the button back to it sits between the two.
    await enterFromComposer(app)
    await expectFocusOn(app, CONVERSATION.scrollToLatest)
    // Tab does not scroll away from what is being read.
    await press(app, 'Shift+Tab')
    const entered = await app.focusedStop()
    expect(entered?.testID).toMatch(/^message-row-/)
    await expect(app.locator(ROW(0))).toBeInViewport()
    await expect(app.page.locator(':focus')).toBeInViewport()

    // A click on a message, then Tab: the ring on that message.
    await app.tap(ROW(3))
    await press(app, 'Tab')
    await expectRing(app, 3)
    await press(app, 'Tab')
    await expectFocusOn(app, CONVERSATION.scrollToLatest)
    await press(app, 'Tab')
    await expectFocusOn(app, CONVERSATION.attachButton)

    // A click beside a message, off its bubble, on the side with room: the same.
    const bubble = await app.locator(ROW(4)).boundingBox()
    const pane = await app.locator(CONVERSATION.attachButton).boundingBox()
    if (bubble === null || pane === null)
      throw new Error('the message or the composer is not drawn')
    const roomBefore = bubble.x - pane.x
    const x = roomBefore > 80 ? pane.x + roomBefore / 2 : bubble.x + bubble.width + 40
    await app.page.mouse.click(x, bubble.y + bubble.height / 2)
    await press(app, 'Tab')
    await expectRing(app, 4)
  } finally {
    await app.close()
  }
})
