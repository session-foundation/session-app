import { expect, test } from '@playwright/test'
import { tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'

import { openFirstConversation } from '../harness/attachments'
import type { Frame } from '../harness/ISessionApp'
import { MobileApp, type MobilePlatform } from '../harness/MobileApp'

const MOBILE_PLATFORMS: readonly MobilePlatform[] = ['android', 'ios']

/** Swipes, each way, before a failed send counts as not in the conversation. */
const MAX_SWIPES = 12

/** A send's way back through the fake's queue. */
const SENT_MS = 15_000

async function failedLines(app: MobileApp): Promise<number> {
  const lines = await app.readAllText(ELEMENT.conversation.messageState)
  return lines.filter((line) => line.includes(tr('tapToRetry'))).length
}

/**
 * A failed send's state line, if one is on screen above the composer. iOS's tree holds rows
 * scrolled out of sight as well, so being in it is not enough.
 */
async function failedOnScreen(app: MobileApp): Promise<Frame | undefined> {
  const screen = await app.frame(ELEMENT.conversation.screen)
  const composer = await app.frame(ELEMENT.conversation.attachButton)
  if (screen === null || composer === null) return undefined
  const lines = await app.readAllText(ELEMENT.conversation.messageState)
  for (const [at, line] of lines.entries()) {
    if (!line.includes(tr('tapToRetry'))) continue
    const frame = await app.frame(ELEMENT.conversation.messageState, at)
    if (frame !== null && frame.y >= screen.y && frame.y + frame.height <= composer.y) return frame
  }
  return undefined
}

/** Scrolls the showcase until a failed send's state line is on screen, and says where it is. */
async function revealFailed(app: MobileApp): Promise<Frame> {
  for (const direction of [1, -1] as const)
    for (let swipe = 0; swipe < MAX_SWIPES; swipe++) {
      const line = await failedOnScreen(app)
      if (line !== undefined) return line
      if (!(await app.scroll(ELEMENT.conversation.screen, direction))) break
    }
  throw new Error('no failed send in the showcase')
}

/**
 * The phones only: the desktop keeps its Retry link. The touch lands on the state line, as a
 * finger's on any part of the bubble would.
 */
for (const platform of MOBILE_PLATFORMS)
  test(`retries a failed send from a touch on its bubble @${platform} @medium-risk`, async () => {
    const app = await MobileApp.launch(platform, 'alice', {
      env: { EXPO_PUBLIC_SESSION_FAKE_FIXTURE: 'showcase' },
    })
    try {
      await openFirstConversation(app)
      const line = await revealFailed(app)
      const before = await failedLines(app)
      // A touch at a point, as a finger's: XCUITest's click on a line that is no control scrolls
      // the list rather than touching it.
      await app.tapPoint(line.x + line.width / 2, line.y + line.height / 2)
      await expect.poll(() => failedLines(app), { timeout: SENT_MS }).toBeLessThan(before)
    } finally {
      await app.close()
    }
  })
