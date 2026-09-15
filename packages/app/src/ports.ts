import type { NetworkName } from '@session/basic-types'
/**
 * What the app needs from the operating system, named so shared code can ask without
 * knowing which one it is running on.
 *
 * libsession owns the database, the network and the protocol, so nothing here is about
 * data - these are the things an OS does: pick a file, show a notification, remember a key.
 *
 * Set once at boot, before anything renders, rather than passed through React context: the
 * store and the boot sequence both read ports from outside any component, and a context
 * could not reach either. requirePorts() throws rather than returning null because a
 * missing port is a mistake in the app's entry file, and failing here names it instead of
 * surfacing three screens later as a null dereference.
 */

export interface SecureStore {
  /**
   * libsession accepts a database key but neither derives nor stores one, so the app
   * generates it on first run and is responsible for keeping it. This is the only secret
   * the port holds.
   */
  getDatabaseKey(): Promise<Uint8Array | null>
  setDatabaseKey(key: Uint8Array): Promise<void>
}

export interface PickedFile {
  /** A real filesystem path: libsession takes paths, not blobs. */
  path: string
  name: string
  contentType?: string
  size?: number
}

export interface FilesPort {
  pickFiles(options?: { multiple?: boolean }): Promise<PickedFile[]>
  pickImages(options?: { multiple?: boolean }): Promise<PickedFile[]>
  /** Where to save something; null when the person cancelled. */
  chooseSaveLocation(suggestedName: string): Promise<string | null>
  openPath(path: string): Promise<void>
  revealInFolder(path: string): Promise<void>
}

/**
 * How an attachment's bytes are named for something that draws them.
 *
 * A URL rather than the bytes: they are resolved natively - a registered scheme on Electron, an
 * image loader on each mobile platform - so they never cross into JavaScript and never ride the
 * frame stream, whose ordering is what makes a display bindable.
 *
 * `null` means this platform has no such resolver yet, and a caller draws the file form instead.
 * A platform that cannot show a picture should say so rather than render a broken one.
 */
export interface MediaPort {
  urlFor(messageId: number, index: number): string | null
}

export interface MediaProbePort {
  /** libsession does not measure images; whoever attaches one supplies the dimensions. */
  imageSize(path: string): Promise<{ width: number; height: number } | null>
}

export interface NotificationsPort {
  requestPermission(): Promise<boolean>
  show(notification: { conversationId: string; title: string; body: string }): Promise<void>
  onTap(handler: (conversationId: string) => void): () => void
  setBadgeCount(count: number): Promise<void>
}

export interface ClipboardPort {
  setString(value: string): Promise<void>
  getString(): Promise<string>
}

export interface LinkingPort {
  openUrl(url: string): Promise<void>
}

export interface WindowPort {
  isFocused(): boolean
  /** Drives read receipts and whether a notification is worth showing. */
  onFocusChange(handler: (focused: boolean) => void): () => void
}

export interface NetworkPort {
  name: NetworkName
}

export interface Ports {
  network: NetworkPort
  secureStore: SecureStore
  files: FilesPort
  media: MediaPort
  mediaProbe: MediaProbePort
  notifications: NotificationsPort
  clipboard: ClipboardPort
  linking: LinkingPort
  window: WindowPort
}

let current: Ports | null = null

export function setPorts(ports: Ports): void {
  current = ports
}

export function requirePorts(): Ports {
  if (current === null) {
    throw new Error(
      'No ports installed. Import the app entry that calls setPorts() before rendering anything from @session/app.',
    )
  }
  return current
}

/** Test seam: lets a suite install its own ports and put them back afterwards. */
export function resetPorts(): void {
  current = null
}
