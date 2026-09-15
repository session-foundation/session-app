import type { BrowserWindow, Session, WebContents, WebPreferences } from 'electron'

/**
 * The renderer's privileges, and what it is allowed to reach.
 *
 * Every flag here is Electron's current default. They are written out because a default is a
 * decision someone else gets to change: an upgrade that flips one is a silent privilege grant to a
 * window that draws message bodies from strangers.
 */
export function hardenedWebPreferences({ packaged }: { packaged: boolean }): WebPreferences {
  return {
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webviewTag: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    // No dictionary downloads, and no context-menu suggestions built from message text.
    spellcheck: false,
    // A shipped build has no use for them, and they are a way into a privileged page.
    devTools: !packaged,
  }
}

/**
 * Excludes the window from screenshots and screen recordings, where the OS can do it.
 *
 * Windows only, which is where Signal draws the same line: it is a real defence against
 * screen-scraping malware there, and elsewhere it either does nothing or breaks the screen sharing
 * someone doing support would ask for. A user-facing setting is what this wants to become.
 */
export function shouldProtectContent(platform: NodeJS.Platform): boolean {
  return platform === 'win32'
}

export function applyContentProtection(window: BrowserWindow, platform: NodeJS.Platform): void {
  if (shouldProtectContent(platform)) window.setContentProtection(true)
}

/**
 * `unsafe-inline` for styles is react-native-web and Tamagui, which both inject a stylesheet at
 * runtime. In dev it also covers the react-refresh preamble, which vite inlines, and `ws:` is HMR.
 */
export function contentSecurityPolicy({ dev }: { dev: boolean }): string {
  return [
    "default-src 'none'",
    `script-src 'self'${dev ? " 'unsafe-inline'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    // session-media: is the one door to an attachment's bytes - see main/media.ts. Named here
    // and nowhere else, so nothing but an image can reach it.
    "img-src 'self' data: blob: session-media:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? ' ws:' : ''}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; ')
}

/**
 * Whether a navigation stays inside the app's own document.
 *
 * The renderer routes with MemoryRouter and never touches the URL, so the only legitimate
 * navigation is a reload of the page already loaded. Anything else is a link in content the app
 * did not write.
 */
export function isAppNavigation(target: string, appUrl: string): boolean {
  let to: URL
  let app: URL
  try {
    to = new URL(target)
    app = new URL(appUrl)
  } catch {
    return false
  }
  // file: has an opaque origin, so compare the path instead.
  if (app.protocol === 'file:') return to.protocol === 'file:' && to.pathname === app.pathname
  return to.origin === app.origin
}

/**
 * Refuses every way a WebContents can become a second one.
 *
 * Separate from `guardNavigation` because it needs no URL, so it can be installed from
 * `web-contents-created` on contents this app did not make and knows nothing about.
 */
export function refuseNewContents(contents: WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  // webviewTag is off, so this is only reachable if something turns it back on.
  contents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })
}

/** Refuses every navigation and every new window that is not the app reloading itself. */
export function guardNavigation(contents: WebContents, appUrl: string): void {
  refuseNewContents(contents)

  contents.on('will-navigate', (event, target) => {
    if (!isAppNavigation(target, appUrl)) event.preventDefault()
  })

  // will-navigate is the main frame only. Frames are refused by the CSP as well; this is what
  // stops one that is somehow already there from navigating.
  contents.on('will-frame-navigate', (event) => {
    if (!isAppNavigation(event.url, appUrl)) event.preventDefault()
  })
}

/**
 * Denies every permission, which is every permission the app does not yet ask for.
 *
 * Notifications are the first one it will want; granting it means deciding that here rather than
 * letting Chromium's prompt decide it in a window showing remote content.
 */
export function denyAllPermissions(session: Session): void {
  session.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false)
  })
  session.setPermissionCheckHandler(() => false)
}
