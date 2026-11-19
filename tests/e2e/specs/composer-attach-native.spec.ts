import { expect, test } from '@playwright/test'
import { ELEMENT } from '@session/test-ids'

import { openFirstConversation } from '../harness/attachments'
import type { Frame } from '../harness/ISessionApp'
import { MobileApp, type MobilePlatform } from '../harness/MobileApp'

const MOBILE_PLATFORMS: readonly MobilePlatform[] = ['android', 'ios']

// @session/ui's native ROW_TOUCH_TARGET: importing ui would pull react-native into Playwright.
const TARGET = 48

/** How far inside the box's edge a touch lands: outside the button drawn at 40 in its middle. */
const INSIDE = 2

/** iOS's tree gives each frame in whole points, and Android's sits on whole pixels. */
const ROUNDING = 1

/** The menu's arrival, on a slow emulator. */
const OPEN_MS = 5_000

type Side = 'left' | 'right' | 'top' | 'bottom'

/** A point just inside one edge of the button's box, outside what it draws. */
function insideEdge(button: Frame, side: Side): [number, number] {
  const centreX = button.x + button.width / 2
  const centreY = button.y + button.height / 2
  switch (side) {
    case 'left':
      return [button.x + INSIDE, centreY]
    case 'right':
      return [button.x + button.width - INSIDE, centreY]
    case 'top':
      return [centreX, button.y + INSIDE]
    case 'bottom':
      return [centreX, button.y + button.height - INSIDE]
  }
}

const SIDES: readonly Side[] = ['left', 'right', 'top', 'bottom']

/**
 * The phones only: on the desktop the button opens the system's file picker, not a menu. A launch
 * per side: iOS drops a menu presented while the last one is still dismissing.
 */
for (const platform of MOBILE_PLATFORMS)
  for (const side of SIDES)
    test(`opens the attach menu from a touch at the ${side} edge of its box @${platform} @medium-risk`, async () => {
      const app = await MobileApp.launch(platform, 'alice')
      try {
        await openFirstConversation(app)
        const button = await app.frame(ELEMENT.conversation.attachButton)
        if (button === null) throw new Error('no attach button')
        expect(button.width).toBeGreaterThanOrEqual(TARGET - ROUNDING)
        expect(button.height).toBeGreaterThanOrEqual(TARGET - ROUNDING)

        const [x, y] = insideEdge(button, side)
        await app.tapPoint(x, y)
        await app.waitForVisible(ELEMENT.conversation.attachMenu, { timeoutMs: OPEN_MS })
      } finally {
        await app.close()
      }
    })
