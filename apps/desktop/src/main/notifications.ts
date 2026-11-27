import electron from 'electron'

import { isFromAppFrame } from './security'

const { app, Notification } = electron

/** What the page asks to post: the words already written, in the person's language. */
interface PostRequest {
  id: string
  title: string
  body: string
  /** Where a click leads: a conversation, at a message, the message requests, or the window. */
  tap:
    | { kind: 'conversation'; conversationId: string; messageId?: number | undefined }
    | { kind: 'requests' }
    | null
  silent: boolean
  /**
   * Posted only while the window does not have focus, as legacy desktop does for messages: with it
   * focused, everything is on screen anyway. False for the Notifications page's preview.
   */
  onlyUnfocused: boolean
}

/** The longest a title or body is let through: the OS truncates long before this. */
const MAX_TEXT_LENGTH = 4096

function postRequest(value: unknown): PostRequest | null {
  if (typeof value !== 'object' || value === null) return null
  const { id, title, body, tap, silent, onlyUnfocused } = value as Record<string, unknown>
  if (typeof id !== 'string' || id.length === 0 || id.length > 256) return null
  if (typeof title !== 'string' || title.length > MAX_TEXT_LENGTH) return null
  if (typeof body !== 'string' || body.length > MAX_TEXT_LENGTH) return null
  if (typeof silent !== 'boolean' || typeof onlyUnfocused !== 'boolean') return null
  return { id, title, body, tap: tapOf(tap), silent, onlyUnfocused }
}

function tapOf(value: unknown): PostRequest['tap'] {
  if (typeof value !== 'object' || value === null) return null
  const { kind, conversationId, messageId } = value as Record<string, unknown>
  if (kind === 'requests') return { kind }
  if (kind === 'conversation' && typeof conversationId === 'string' && conversationId.length < 256)
    return {
      kind,
      conversationId,
      messageId: Number.isSafeInteger(messageId) ? (messageId as number) : undefined,
    }
  return null
}

/**
 * The OS notifications the page posts, by the id the bridge gave each, so that a later
 * `notifications-stale` can take one down. Electron keeps none of this itself: a notification
 * nothing holds is collected, and with it the click handler.
 */
export function serveNotifications(window: Electron.BrowserWindow, appUrl: string): void {
  const { ipc } = window.webContents
  const shown = new Map<string, Electron.Notification>()

  ipc.on('notifications:post', (event, value: unknown) => {
    if (!isFromAppFrame(event.senderFrame, appUrl) || !Notification.isSupported()) return
    const request = postRequest(value)
    if (request === null) return
    // Main's word for focus, which is the OS's: the page's can stay true behind another window.
    // Focused, everything it counts is on screen: the page forgets them, as legacy desktop does.
    if (request.onlyUnfocused && window.isFocused()) {
      window.webContents.send('notifications:seen')
      return
    }
    shown.get(request.id)?.close()
    const notification = new Notification({
      title: request.title,
      body: request.body,
      silent: request.silent,
    })
    notification.on('click', () => {
      if (window.isDestroyed()) return
      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
      if (request.tap !== null) window.webContents.send('notifications:tap', request.tap)
    })
    notification.on('close', () => {
      if (shown.get(request.id) === notification) shown.delete(request.id)
    })
    shown.set(request.id, notification)
    notification.show()
    // As legacy desktop does on Windows, where a notification alone is easy to miss.
    if (process.platform === 'win32' && !window.isFocused()) window.flashFrame(true)
  })

  ipc.on('notifications:remove', (event, ids: unknown) => {
    if (!isFromAppFrame(event.senderFrame, appUrl) || !Array.isArray(ids)) return
    for (const id of ids) {
      if (typeof id !== 'string') continue
      shown.get(id)?.close()
      shown.delete(id)
    }
  })

  ipc.on('notifications:badge', (event, count: unknown) => {
    if (!isFromAppFrame(event.senderFrame, appUrl)) return
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) return
    // Where the OS has one: the dock on macOS, the launcher on some Linux desktops.
    app.setBadgeCount(count)
  })

  // Back in the window, everything counted is on screen: down it comes, and the page starts afresh.
  window.on('focus', () => {
    if (process.platform === 'win32') window.flashFrame(false)
    for (const notification of shown.values()) notification.close()
    shown.clear()
    window.webContents.send('notifications:seen')
  })
}
