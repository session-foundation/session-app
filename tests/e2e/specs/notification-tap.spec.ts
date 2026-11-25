import { expect, test } from '@playwright/test'
import { replies } from '@session/client/fake'
import { ELEMENT } from '@session/test-ids'

import type { DesktopApp } from '../harness/DesktopApp'
import { SEEDED_PEER_ID, SEEDED_REPLIES as REPLIES } from '../harness/fixtures'
import { launchLongConversation as launch, messageSaying as row } from '../harness/longConversation'

const CONVERSATION = ELEMENT.conversation

/**
 * The id Alice's device knows a message by, from the same fixture the app boots: ids are given
 * out in order from a reset, so a second build of it numbers the messages alike. A row's test id
 * is its place in the window, not this.
 */
function idOf(body: string): number {
  const { world } = replies()
  const id = world
    .account('Alice')
    .messages(SEEDED_PEER_ID)
    .find((m) => m.body === body)?.id
  if (id === undefined) throw new Error(`"${body}" is not in the replies fixture`)
  return id
}

/** On screen and ringed by the landing's highlight. */
async function expectLandedOn(app: DesktopApp, body: string): Promise<void> {
  const landed = row(app, body)
  await expect(landed).toBeInViewport({ ratio: 1 })
  await expect(landed.getByTestId(CONVERSATION.messageHighlight)).toHaveCount(1)
}

test('opens a tapped notification on its message, pages above the newest and not the oldest unread @desktop @high-risk', async () => {
  const app = await launch()
  try {
    // Both far above the page the conversation opens on, and far apart.
    const station = idOf(REPLIES.station)
    const meet = idOf(REPLIES.meet)
    await expect(row(app, REPLIES.station)).toHaveCount(0)

    // From elsewhere: the conversation opens on the message, not on its newest page.
    await app.tapNotification({ kind: 'requests' })
    await expect(app.locator(ELEMENT.requests.screen)).toBeVisible()
    await app.tapNotification({
      kind: 'conversation',
      conversationId: SEEDED_PEER_ID,
      messageId: station,
    })
    await expectLandedOn(app, REPLIES.station)
    await expect(row(app, REPLIES.newest)).toHaveCount(0)

    // With the conversation open, a tap moves it to a message outside the window it holds.
    await expect(row(app, REPLIES.meet)).toHaveCount(0)
    await app.tapNotification({
      kind: 'conversation',
      conversationId: SEEDED_PEER_ID,
      messageId: meet,
    })
    await expectLandedOn(app, REPLIES.meet)
  } finally {
    await app.close()
  }
})
