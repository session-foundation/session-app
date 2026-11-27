import type { IncomingNotification, SessionEvent } from '@session/client'
import { emptyState, type SessionState } from '@session/state'
import { describe, expect, it, vi } from 'vitest'

import { followNotifications } from '#src/notifications'

const MESSAGE: IncomingNotification = {
  id: 'hash-1',
  kind: 'message',
  conversationId: '05' + 'a'.repeat(64),
  sender: 'Bob',
  body: 'hi',
  attachments: 0,
  timestamp: 1,
}

function harness(state: Partial<SessionState>, shouldPost = () => true) {
  let deliver: (event: SessionEvent) => void = () => {}
  const notifications = {
    post: vi.fn(),
    remove: vi.fn(),
    setBadgeCount: vi.fn(() => Promise.resolve()),
  }
  followNotifications({
    client: {
      onEvent: (listener) => {
        deliver = listener
        return () => {}
      },
    },
    store: { getState: () => ({ ...emptyState, ...state }) },
    notifications,
    shouldPost,
  })
  return { notifications, deliver: (event: SessionEvent) => deliver(event) }
}

describe('following notifications', () => {
  it('posts what the bridge says to, with desktop audio as set', () => {
    const { notifications, deliver } = harness({ audioNotifications: true })
    deliver({ type: 'notification', notification: MESSAGE })
    expect(notifications.post).toHaveBeenCalledWith(MESSAGE, { audio: true })
  })

  it('posts nothing with desktop notifications off, or where the platform says not now', () => {
    const off = harness({ notificationsShown: false })
    off.deliver({ type: 'notification', notification: MESSAGE })
    expect(off.notifications.post).not.toHaveBeenCalled()

    const focused = harness({}, () => false)
    focused.deliver({ type: 'notification', notification: MESSAGE })
    expect(focused.notifications.post).not.toHaveBeenCalled()
  })

  it('takes down what is stale and counts the badge', () => {
    const { notifications, deliver } = harness({})
    deliver({ type: 'notifications-stale', ids: ['hash-1'] })
    deliver({ type: 'badge', count: 4 })
    expect(notifications.remove).toHaveBeenCalledWith(['hash-1'])
    expect(notifications.setBadgeCount).toHaveBeenCalledWith(4)
  })
})
