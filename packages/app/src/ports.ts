import type { NetworkName, QrMark, WithSpan } from '@session/basic-types'
import type {
  AttachmentRef,
  IncomingNotification,
  NotificationSound,
  PixelSize,
  PushService,
} from '@session/client'
import type {
  BuildFacts,
  DiagnosticsSnapshot,
  ExportPart,
  ExtensionRuns,
  LogFileInfo,
} from '@session/logging'
import type { DeliveryMode } from '@session/state'

import type { BuildVariant } from './buildVariant'
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
  contentType?: string | undefined
  size?: number | undefined
  /**
   * When the file was last changed, where the platform says: with its size, what tells a file
   * picked again unchanged from one edited since.
   */
  modifiedMs?: number | undefined
  /**
   * A URL the platform can draw the file from, where it is a picture. Nothing for anything else:
   * a video has no still yet, so it stages as a document.
   */
  previewUrl?: string | undefined
}

export interface FilesPort {
  pickFiles(options?: { multiple?: boolean }): Promise<PickedFile[]>
  /** `limit` is how many more the message can take, which a picker that can stop at it does. */
  pickImages(options?: { multiple?: boolean; limit?: number | undefined }): Promise<PickedFile[]>
  /**
   * The files behind what was dropped on the window, as `DropZone` handed them over.
   *
   * Only desktop takes a drop, and only it can say where a dropped file lives on disk. Anything
   * not on disk -- a picture dragged out of a browser -- has no path and is left out.
   */
  droppedFiles(items: readonly unknown[]): Promise<PickedFile[]>
  /**
   * Whether each pick is a copy the app made, which a fresh path for the same file says nothing
   * against. True on mobile; on desktop a pick is the person's own file at its own path.
   */
  picksAreCopies: boolean
  /**
   * Lets go of a pick that will not be sent: deletes the app's copy, where it made one.
   *
   * Never for a file a message has been given: a copy is then libsession's, handed over with
   * `takeFile`, and the person's own file is not the app's to delete.
   */
  discardPicked(file: PickedFile): void
  /**
   * Lets go of what the platform holds for a pick in the tray, for every pick that leaves it, sent
   * or not. Desktop grants the page each preview, and the right to send the file; a preview grant
   * held for a file nobody draws pushes out one in use.
   */
  releasePreview(file: PickedFile): void
  /**
   * Where to export a file to; null when the person cancelled.
   *
   * `contentType` is the sender's claim, for a platform whose destination depends on the kind of
   * file: mobile sends a picture to the photo library and anything else to a folder. Unset files
   * it as a plain file, which is how a picture sent as its original file is exported.
   *
   * Rejects with `ExportAccessRefused` when that destination needs access that was refused.
   */
  chooseExportLocation(suggestedName: string, contentType?: string): Promise<string | null>
  openPath(path: string): Promise<void>
  /**
   * Shows the person where an export landed.
   *
   * On mobile this is also where the file reaches its destination: libsession writes to a real
   * path, and neither a photo library nor a picked folder is one.
   */
  revealInFolder(path: string): Promise<void>
  /**
   * Saves a QR code of `value` as a PNG wherever the person chooses, with `mark` in its middle
   * where there is one, or null where there is no file to save it to. Desktop only, as in the
   * legacy desktop client, which offers it on the recovery password's full-screen QR. Resolves
   * false when the person cancelled.
   */
  saveQrCode: ((value: string, mark: QrMark | null) => Promise<boolean>) | null
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
  urlFor(ref: AttachmentRef): string | null
  /**
   * The sender's ThumbHash, decoded, for drawing before the file arrives.
   *
   * A second URL rather than a second kind of value, so a placeholder reaches the screen by the
   * same route a picture does and nothing has to hold pixels to show one. Only worth asking for
   * when `Attachment.hasThumbhash` says there is one.
   */
  thumbhashUrlFor(ref: AttachmentRef): string | null
  /**
   * The JPEG libsession made of a picture it holds, in the picture's shape (`Attachment`'s
   * `thumbnailWidthPx` by `thumbnailHeightPx`), which is what a tile draws: a viewer draws
   * `urlFor`. Never a download, so only worth asking for when `Attachment.hasThumbnail` says there
   * is one.
   *
   * TODO: an animated thumbnail for an animated GIF or WebP, so it plays in the conversation and
   * not only in the viewer. Today this is a still of the first frame; libsession would make an
   * animated WebP on demand, and desktop main, the iOS loader and anything wanting a still assume
   * a JPEG.
   */
  thumbnailUrlFor(ref: AttachmentRef): string | null
  /**
   * The display copy libsession made of a picture it holds, which the viewer draws in place of
   * the file. Never a download, so only worth asking for when `Attachment.hasRendition` says
   * there is one.
   */
  renditionUrlFor(ref: AttachmentRef): string | null
}

export interface MediaProbePort {
  /** libsession does not measure images; whoever attaches one supplies the dimensions. */
  imageSize(path: string): Promise<PixelSize | null>
}

/** A push token, named by the push server's name for the service that issued it. */
export interface PushToken {
  service: PushService
  token: string
}

/**
 * This device's push token, from APNs, FCM or Huawei's push kit as the build has.
 *
 * Kept apart from registering it with the push server, which is libsession's (`setPushToken`), so
 * every platform shares one rule for when that happens: see `followPushRegistration`.
 */
export interface PushTokenSource {
  /**
   * Asks for permission to notify where the OS needs it, then answers the token. Null when the
   * service can't issue one: no Play Services, say, or registration refused.
   */
  token(): Promise<PushToken | null>
  /** Calls back when the service issues a new token, which it can do at any launch. */
  onChange(listener: () => void): () => void
}

/**
 * Whether this install has subscribed for pushes, kept where an uninstall always removes it.
 *
 * libsession keeps the subscription it last sent in the database and sends nothing while it still
 * matches. On iOS the database can be in the app group, which can outlive the app: a reinstall
 * then finds a matching record for a subscription the push server may have dropped, and gets no
 * pushes until the record is a day old. So the first subscription of an install is forced.
 */
export interface PushInstallMarker {
  subscribed(): boolean
  markSubscribed(): void
}

/** Android's notification channels, whose sound and vibration are set in Android's settings. */
export type NotificationChannel = 'messages' | 'requests' | 'calls'

/** Where a tapped notification leads: a message's conversation, or the message requests. */
export type NotificationTap =
  { kind: 'conversation'; conversationId: string } | { kind: 'requests' }

/** One delivery mode as the platform offers it. */
export interface DeliveryModeOffer {
  mode: DeliveryMode
  /**
   * Why the mode cannot be used, or null when it can: `build` when this build leaves it out (no
   * push service in an F-Droid build), `device` when the device lacks what it needs (no Play
   * services).
   */
  unavailable: 'build' | 'device' | null
}

export interface NotificationsPort {
  /**
   * The delivery modes this platform offers, in the order they are listed, each with whether it can
   * be used here. Empty where `notificationModesApply` is false.
   *
   * A mode that cannot be used stays in the list, marked, rather than being dropped: Instant is the
   * recommended choice wherever it exists, and leaving it out makes the others look like the only
   * design rather than the fallback. Which modes there are, and whether each works, depends on how
   * the build was assembled and on the device, so it is answered at the app edge.
   */
  readonly deliveryModes: readonly DeliveryModeOffer[]
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
  /**
   * Where fast mode gets its push token: null where this build has no push service behind it,
   * which is also when Instant is unavailable. See `PushTokenSource`.
   */
  readonly pushTokens: PushTokenSource | null
  /** Null where there is no push service. See `PushInstallMarker`. */
  readonly pushInstallMarker: PushInstallMarker | null
  /**
   * Whether a notification makes its sound while the app is in front, until somebody chooses. On
   * for both phones, though legacy iOS has it off.
   */
  readonly soundWhenOpenDefault: boolean
  /** Whether the OS lets the app post notifications, or null where it cannot be asked. */
  readonly notificationsAllowed: (() => Promise<boolean>) | null
  /** Opens the OS's notification settings for the app, or null where there are none to open. */
  readonly openSettings: (() => void) | null
  /** Android's notification channels: opens one channel's own settings. Null elsewhere. */
  readonly openChannelSettings: ((channel: NotificationChannel) => void) | null
  /**
   * Android's battery-optimisation exemption, which the background delivery modes depend on:
   * whether the app has it, and asking for it or giving it back. Null elsewhere.
   */
  readonly backgroundActivity: { allowed(): Promise<boolean>; change(): void } | null
  /** Whether iOS has Background App Refresh on for the app. Null elsewhere. */
  readonly backgroundRefreshOn: (() => Promise<boolean>) | null
  /**
   * Plays one of the notification sounds, as the Sound screen does when one is picked. Null where
   * the sound is not chosen in the app, which hides the Sound row: Android sets it on each
   * notification channel in its own settings, and desktop has only an on or off switch.
   */
  readonly playSound: ((sound: NotificationSound) => void) | null
  /** Posts a sample notification, or null where the platform cannot post one. */
  readonly preview: ((sample: { title: string; body: string }) => Promise<void>) | null
  requestPermission(): Promise<boolean>
  /**
   * Posts a notification for a message that arrived while the app runs, in the platform's words
   * (see `followNotifications`). `audio` is desktop's switch; the phones' sound is their own. Null
   * where nothing posts one.
   */
  readonly post: ((notification: IncomingNotification, options: { audio: boolean }) => void) | null
  /** Takes down notifications by their ids, posted here or by a push. Null where none are. */
  readonly remove: ((ids: readonly string[]) => void) | null
  onTap(handler: (tap: NotificationTap) => void): () => void
  setBadgeCount(count: number): Promise<void>
}

/**
 * Write only. Pasting into a field needs no port; a Paste button would, and desktop would then
 * need its own gated read in the main process, because the renderer is refused `clipboard-read`.
 */
export interface ClipboardPort {
  setString(value: string): Promise<void>
  /**
   * Copies something secret, such as the recovery password. Marked sensitive where the OS has a
   * flag for it -- Android 13 and later, whose clipboard preview then hides it -- and copied as
   * `setString` would anywhere else.
   */
  setSecret(value: string): Promise<void>
  /**
   * Whether the OS says so itself when something is copied, so the app should not as well.
   * Android 13 and later show a clipboard preview on every copy.
   */
  readonly confirmsCopy: boolean
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

/**
 * Which build this is: the version it was released as and the commit it was made from.
 *
 * Answered where the build is assembled, as the rest of these are: the version is each app's own,
 * and the commit is read from git by the bundler as it builds, which a committed file could not do
 * -- it would have to contain the hash of the commit it is in. Wanted by the settings stamp, and by
 * any log that has to say which binary produced it.
 */
/**
 * What the build says about itself; see `BuildFacts` in `@session/logging`. The variant is one of
 * `BUILD_VARIANTS` here, which the logs print as it is.
 */
export type BuildPort = Readonly<Omit<BuildFacts, 'variant'> & { variant: BuildVariant }>

export interface SharePort {
  /**
   * Hands text to the platform's share sheet, or null where there is none (the desktop).
   *
   * Null rather than a no-op, so a screen leaves out what would only send through it.
   */
  shareText: ((text: string) => Promise<void>) | null
  /**
   * Hands a QR code of `value`, with `mark` in its middle where there is one, to the share sheet
   * as a PNG, from which it can be saved to Files, or null where there is no sheet (the desktop
   * saves it instead: `files.saveQrCode`). Never to the photo library, which backs itself up to
   * the cloud.
   */
  shareQrCode: ((value: string, mark: QrMark | null) => Promise<void>) | null
}

export interface WindowPort {
  /**
   * Shuts the app down, or null where the build cannot.
   *
   * Two callers. A screen's Quit, where the app cannot get going. And the end of a clear on a
   * device whose account was loaded, where `restart` cannot be had: by then the account's messages
   * and names have sat in JavaScript strings, which nothing can scrub, and only the end of the
   * process gives that memory back.
   *
   * Desktop quits through main, which ends the process on macOS too, where closing the last window
   * does not. The phones end the process at once, without the teardown `exit()` runs -- see
   * `modules/process-exit` in the mobile app. Null
   * where a phone build predates that module, so a screen omits the control rather than offering
   * one that does nothing.
   */
  close: (() => void) | null
  /**
   * Ends the process and starts the app again in a fresh one, or null where the platform cannot.
   *
   * What a clear of a loaded account ends with where it can be had: the same reason as `close`,
   * and the person lands on onboarding rather than at a home screen that looks like a crash.
   * Desktop relaunches through main; Android restarts its task. iOS lets no app relaunch itself,
   * so it is null there and the caller falls back to `close`.
   */
  restart: (() => void) | null
  /**
   * Keeps whatever is on screen out of screenshots, recordings and the recents thumbnail while
   * `true`, or null where the platform is not asked to. Android's secure window flag; a screen
   * that shows a secret sets it on the way in and clears it on the way out.
   *
   * Resolves once the window has it, for whatever then has to be drawn after. Counted: the flag
   * clears a moment after the last `true` is matched by a `false`, so a screen that is mounted
   * again in place never leaves a gap with it off.
   */
  preventScreenCapture: ((prevented: boolean) => Promise<void>) | null
  isFocused(): boolean
  /** Drives read receipts and whether a notification is worth showing. */
  onFocusChange(handler: (focused: boolean) => void): () => void
  /**
   * The list of keyboard shortcuts, or null where the app handles none.
   *
   * Null on the phones and tablets: React Native hands JavaScript no key events on iOS, so the keys
   * the screens handle work in the desktop app only (#533).
   */
  keyboardShortcuts: KeyboardShortcutsPort | null
}

export interface KeyboardShortcutsPort {
  /** Whether the keys are named as a Mac's keyboard prints them (⌘ ⇧) or as a PC's (Ctrl Shift). */
  keyNames: 'mac' | 'pc'
  /**
   * Called when the person picks Help > Keyboard Shortcuts, from the menu bar or with Ctrl+/ (⌘/
   * on a Mac).
   */
  onOpenList(handler: () => void): () => void
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

/**
 * The log files, for the export. Each platform keeps its own - desktop's in the main process, the
 * phones' in the app's documents - so what the export needs from them is asked for here.
 *
 * **Compression is the platform's, not JavaScript's.** Twenty megabytes through fflate on Hermes
 * takes seven and a half seconds with the JS thread frozen; desktop's main process has zlib, and
 * the phones a small native module. See the spec's Compression section.
 */
export interface LogsPort {
  /** Everything written so far on disk, then the retained files, oldest first. */
  retained(): Promise<LogFileInfo[]>
  /**
   * The runs of processes that write beside the app's logs rather than through it - the iOS
   * notification extension - for the export to add after the app's own. Null where no such process
   * exists.
   */
  extensionRuns: (() => Promise<ExtensionRuns[]>) | null
  /** The first line of one file and the last of another: the window an export covers. */
  span(first: string, last: string): Promise<WithSpan>
  /**
   * Compresses the parts, in order, into one gzip file called `name`, and hands it to the person:
   * a save dialog on desktop, the share sheet on a phone. False when they cancelled, where the
   * platform can tell; null where this build cannot export at all, so a screen leaves the control
   * out.
   */
  deliver: ((name: string, parts: readonly ExportPart[]) => Promise<boolean>) | null
  /**
   * How `deliver` hands the file over, which is what a screen's copy has to describe: saved
   * somewhere the person chooses, or passed to another app through the share sheet.
   */
  deliversBy: 'saveDialog' | 'shareSheet'
}

export interface DiagnosticsPort {
  snapshot(): Promise<DiagnosticsSnapshot>
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
  share: SharePort
  build: BuildPort
  window: WindowPort
  logs: LogsPort
  diagnostics: DiagnosticsPort
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
