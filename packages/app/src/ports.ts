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
  /**
   * Whether this build has a push service behind it.
   *
   * Onboarding asks which of two notification modes to use, and marks the push one either
   * `recommended` or `unavailable`. Which of those it is depends on how the build was assembled --
   * a Play build has FCM, an F-Droid or web-download build does not, and desktop has neither --
   * so it is answered at the app edge rather than guessed at from the platform.
   *
   * False everywhere today: there is no push service wired up on any of the three. It turns true
   * per build as one arrives.
   */
  readonly fastModeAvailable: boolean
  /**
   * Which push service fast mode would use.
   *
   * Not decoration: the catalogue carries three descriptions of fast mode -- Apple's, Google's and
   * Huawei's -- and onboarding has to name the one this build would actually talk to. Reading it
   * off `Platform.OS` would be wrong on Android, where a Play build and a Huawei build are the
   * same platform and different services, so this is answered where the build is assembled.
   *
   * Null where there is none. The screen then falls back to the unqualified description, which is
   * all it can honestly say about a mode it is about to mark unavailable.
   */
  readonly pushService: 'apple' | 'google' | 'huawei' | null
  /**
   * Whether this platform suspends the app and so makes notification delivery a choice.
   *
   * A phone or a tablet stops running Session the moment it is put down, so somebody has to say
   * how it should hear about a message in the meantime - a push service, or the background windows
   * the OS grants. A desktop app just keeps running and keeps polling, so there is nothing to
   * choose between and onboarding skips the question entirely.
   *
   * Answered at the app edge rather than from the window's width, because a tablet gets the
   * desktop *layout* and still has to be asked: the two are different questions and reading one
   * off the other is what put a phone's question on a desktop screen.
   */
  readonly notificationModesApply: boolean
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
  /**
   * The app's own page in the OS settings, or null where there is no such thing.
   *
   * Both mobile platforms have it for any installed app, which is where a permission the OS will
   * not ask about again can still be changed.
   */
  openAppSettings: (() => Promise<void>) | null
}

export interface WindowPort {
  /**
   * Shuts the app down, or null where the platform cannot.
   *
   * **This exists for the case that needs it rather than as a quit button.** After the device's
   * data is cleared the process is holding a database that no longer exists, and the legacy
   * clients do not try to carry on either -- iOS calls `exit(0)` straight after clearing. Ending
   * the process is what makes the next launch the clean one.
   *
   * Desktop closes its window, which with one window is quitting. Android ends its task. **Null on
   * iOS**, which offers no way to do this from JavaScript, so the screen reads the null and omits
   * the control rather than offering one that does nothing.
   *
   * TODO: give iOS one. The legacy client calls `exit(0)` straight after clearing, so the gap is
   * a native call the bridge does not expose rather than something the platform refuses -- and
   * until it exists, an iOS device whose data was just cleared is left holding a database that no
   * longer exists until somebody relaunches by hand.
   */
  close: (() => void) | null
  isFocused(): boolean
  /** Drives read receipts and whether a notification is worth showing. */
  onFocusChange(handler: (focused: boolean) => void): () => void
}

export interface NetworkPort {
  /**
   * Which network this build is talking to, `fake` included.
   *
   * **The fake is one of the answers rather than a flag beside them.** A fake build looks exactly
   * like a real one and the difference decides whether anything on screen means anything, so it
   * is the same question as "which network" and has the same one answer. It is a fact about how
   * the app was started, which is why it arrives as a port rather than being read from an
   * environment variable in the middle of a screen.
   *
   * Not what libsession is handed: nothing is attached for the fake. See `NetId`.
   */
  name: NetworkName
}

export interface FlagsPort {
  /**
   * The raw value of an environment variable, or null when it is unset.
   *
   * A port because the three platforms expose the environment differently -- `process.env` in the
   * Electron main process, a build-time define in the renderer, and Expo's config extras on
   * mobile -- and shared code should not know which of those it is standing on. It returns the raw
   * string rather than a boolean so the parsing rule lives in one place, next to the flag table.
   */
  override(name: string): string | null
}

export interface Ports {
  network: NetworkPort
  flags: FlagsPort
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
