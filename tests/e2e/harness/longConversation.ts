import { expect, type Locator } from '@playwright/test'
import { ELEMENT } from '@session/test-ids'

import { openFirstConversationAtNewest } from './attachments'
import { DesktopApp } from './DesktopApp'

/**
 * Alice's desktop on a `replies` fixture, in Bob's conversation: several pages of history, so
 * it opens on a window that does not reach the first message.
 *
 * Launched directly rather than through `sessionTest`: where a row sits in the window, a
 * right-click and a double-click are Playwright's to ask and do, not `ISessionApp`'s.
 */
export async function launchLongConversation(
  fixture: 'replies' | 'repliesNearEnd' = 'replies',
): Promise<DesktopApp> {
  const app = await DesktopApp.launch('alice', {
    env: { EXPO_PUBLIC_SESSION_FAKE_FIXTURE: fixture },
  })
  await openFirstConversationAtNewest(app)
  await expect(app.locator(ELEMENT.conversation.headerName)).toHaveText('Bob')
  return app
}

/** The message saying `body`, wherever it is in the window: a row's index moves as pages arrive. */
export function messageSaying(app: DesktopApp, body: string): Locator {
  return app.page.getByTestId(/^message-row-\d+$/).filter({
    has: app.locator(ELEMENT.conversation.messageBody).getByText(body, { exact: true }),
  })
}
