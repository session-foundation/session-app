/**
 * English that has no catalogue key yet, quarantined in one file.
 *
 * Every other word a person reads comes from the catalogue, and `copy.contract.test.ts` in
 * `@session/screens` enforces that across every screen. These do not: the attachment cache section,
 * the set's own count, the gallery/list switch, the export verb and the auto-download prompt's
 * choice need them and the Crowdin set has nothing that fits, so they ship as English in every
 * locale until the keys land.
 *
 * Each name is the token it is destined for, so promoting one is a swap:
 * `PENDING_COPY.attachmentCache` becomes `tr('attachmentCache')` and the entry goes. Adding to
 * this is not a way around the rule - a new entry needs the same pull request against
 * session-localization that it would have needed anyway.
 */
export const PENDING_COPY = {
  attachmentCache: 'Attachment Cache',
  attachmentCacheUsage: 'Space used',
  attachmentCacheLimit: 'Limit',
  attachmentCacheNoLimit: 'No limit',
  /**
   * A function, because this one takes a count.
   *
   * Two forms is English, not a rule: the catalogue resolves `{count}` against each locale's own
   * plural categories, of which Arabic has six. So this ships wrong in more places than the
   * others here, and the swap to `tr('attachmentCount', { count })` is what fixes it.
   */
  attachmentCount: (count: number): string =>
    count === 1 ? '1 attachment' : `${String(count)} attachments`,
  attachmentViewGallery: 'Show as gallery',
  attachmentViewList: 'Show as list',
  /**
   * Writing a file we already hold out to a folder somebody chose.
   *
   * The catalogue has `save`, `saving` and `saved`, and every one of them is used for the
   * download as well - which is how the same word ends up on a row that has nothing and on a row
   * that has everything. The only Export in the set is `helpReportABugExportLogs`, which is
   * about logs.
   */
  export: 'Export',
  /**
   * Where the Recovery Password row was, once it is hidden: people who hid it write in asking where
   * it went, and the answer is often another device they are still signed in on.
   */
  recoveryPasswordHiddenOnDevice: 'Recovery Password hidden on this device',
  exporting: 'Exporting',
  exportFailed: 'Export failed',
  previous: 'Previous',
  /**
   * An album's picture with no filename, by its place among the album's pictures. Counts in
   * English only, as `attachmentCount` does.
   */
  attachmentImagePosition: (position: number, count: number): string =>
    `Image ${String(position)} of ${String(count)}`,
  /**
   * Which of a message's pictures the viewer is showing, in its header. Words rather than "2 / 3",
   * so each locale orders the two numbers as it reads them.
   */
  attachmentViewerPosition: (position: number, count: number): string =>
    `${String(position)} of ${String(count)}`,
  /**
   * What a screen reader calls the tile under "+N": its own name and the count it stands for. One
   * string, so each locale orders and punctuates both parts itself; `andMore` is only the "+N".
   */
  attachmentNameAndMore: (name: string, count: number): string =>
    `${name}, and ${String(count)} more`,
  /**
   * The composer refusing files past the per-message limit.
   *
   * `attachmentsErrorNumber` says "image and video files", which is wrong once any type can be
   * staged.
   */
  attachmentsErrorLimit: (max: number): string =>
    `Unable to send more than ${String(max)} files at once.`,
  /**
   * The composer refusing a picture past libsession's decode limits, which is a matter of its
   * pixels rather than its bytes, so `attachmentsErrorSize` would name the wrong limit.
   */
  attachmentsErrorImageTooLarge: 'Image too large to send',
  /** How many files that refusal left out. Counts in English only, as `attachmentCount` does. */
  attachmentsNotAdded: (count: number): string => `${String(count)} not added`,
  /** Over the staged tray: how many of the message's allowance are used. */
  attachmentsStagedCount: (count: number, max: number): string =>
    `${String(count)} / ${String(max)}`,
  /** That count as a screen reader says it. Counts in English only, as `attachmentCount` does. */
  attachmentsStagedCountSpoken: (count: number, max: number): string =>
    `${String(count)} of ${String(max)} attachments`,
  /** A file of a message being sent, waiting for the ones before it to upload. */
  attachmentQueued: 'Queued',
  /** A file of a failed message that was never tried, since the one before it failed. */
  attachmentNotSent: 'Not sent',
  /** A sending set's footer. Counts in English only, as `attachmentCount` does. */
  attachmentsUploaded: (uploaded: number, count: number): string =>
    `${String(uploaded)} of ${String(count)} uploaded`,
  /**
   * A running download's reading as a screen reader says it, beside the "12 MB / 30 MB" the footer
   * shows, and an upload's alike. Both sizes arrive already formatted. One string, so each locale
   * orders the two itself.
   */
  attachmentsDownloadProgress: (done: string, total: string): string => `${done} of ${total}`,
  /** Beside Show All when a file it hides failed. */
  attachmentsFailedCount: (count: number): string => `${String(count)} failed`,
  /**
   * Under the drop overlay's title, which is `attachmentsAdd`. Only a picture libsession decodes,
   * within its pixel limit, is shrunk; any other has the files' limit.
   */
  attachmentsDropHint: (max: number, size: string): string =>
    `Up to ${String(max)} files under ${size}; pictures are shrunk to fit`,
  /** A staged tile's remove button, which has to say which file. */
  attachmentRemove: (name: string): string => `Remove ${name}`,
  /** The auto-download prompt's two answers to what Yes fetches. */
  autoDownloadAllFiles: 'All files',
  autoDownloadImagesOnly: 'Images only',
  /**
   * The onion path's state, named beside its dot wherever one is drawn: the rail's tooltip, the
   * Settings row's value. The dot is green or red, which a red-green colour-blind reader cannot
   * tell apart, so the word is what carries it. The only Connecting in the set is
   * `callsConnecting`, which is about a call and has an ellipsis. Unknown has a key, `unknown`.
   */
  onionRoutingPathConnected: 'Connected',
  onionRoutingPathConnecting: 'Connecting',
  /** No path: the network is down, or none is attached. */
  onionRoutingPathOffline: 'Offline',
  /**
   * The light/dark toggle's name: what a press does. Naming the mode the glyph shows instead read
   * as the mode it would turn on, so Dark Mode while dark was taken for a switch to dark.
   */
  changeToLightMode: 'Change to Light Mode',
  changeToDarkMode: 'Change to Dark Mode',
  /**
   * Up and Down in a conversation, in the list of keyboard shortcuts. `conversationNavigate` is
   * Navigate to Conversation, which is a different command.
   */
  messageNavigate: 'Move Between Messages',
  /**
   * What a press on a reply's quote does, said after its name. Android's "Reply to message" is no
   * catalogue string either, and `reply` already names the action that starts one.
   */
  messageQuoteHint: 'Shows the original message',
  /**
   * The transcript's floating button, in its two states: no client has a way back after a jump, and
   * nothing in the catalogue names the button that goes to the newest message.
   */
  messageScrollToLatest: 'Scroll to latest message',
  messageBackToReply: 'Back to reply',
} as const
