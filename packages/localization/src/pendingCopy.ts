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
  /** Beside Retry, where a conversation's messages, or a page of them, could not be read. */
  messagesLoadFailed: 'Unable to load messages',
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
  /** Left and Right in the full-screen viewer, in the list of keyboard shortcuts. */
  attachmentNavigate: 'Move Between Attachments in Full Screen',
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
  /**
   * The path screen's figures, under its country flow: a figure above each, so they read on as
   * "3 paths in use". The catalogue has the path's node names (`onionRoutingPathEntryNode` and the
   * rest) but nothing for counts or timings.
   */
  onionRoutingPathsInUse: 'paths in use',
  onionRoutingPathCountries: 'countries crossed',
  onionRoutingPathEntryNodes: 'entry nodes',
  onionRoutingPathRebuilt: 'rebuilt since opening',
  onionRoutingPathAverage: 'average round trip',
  onionRoutingPathFastest: 'fastest path',
  onionRoutingPathSlowest: 'slowest path',
  onionRoutingPathJitter: 'jitter',
  /** A round trip in milliseconds; the figure is a whole number. */
  onionRoutingPathMilliseconds: '{ms} ms',
  /** Jitter: how far round trips stray either side of each other, in whole milliseconds. */
  onionRoutingPathJitterMilliseconds: '±{ms} ms',
  /**
   * The timings under onion requests, which send no pings: each figure is how long requests took
   * to be answered, the destination's own time included, not a path's round trip.
   */
  onionRoutingPathAverageResponse: 'average response',
  onionRoutingPathFastestResponse: 'fastest response',
  onionRoutingPathSlowestResponse: 'slowest response',
  /**
   * In place of a figure that cannot be measured: jitter under onion requests, whose requests
   * differ too much in kind and size for the gaps between their round trips to say anything of the
   * path.
   */
  onionRoutingPathNotApplicable: 'N/A',
  /**
   * The path screen's introduction: `onionRoutingPathDescription` without its closing "This is
   * your current path:", which introduced the single path the old screen drew.
   */
  onionRoutingPathIntro:
    "Session hides your IP by routing your messages through multiple service nodes in Session's decentralized network.",
  /**
   * The flow's column headings for the first relay and the two after it. The catalogue's
   * `onionRoutingPathEntryNode` and `onionRoutingPathServiceNode` are too wide for five columns
   * across a phone: at 390 points they run into each other.
   */
  onionRoutingPathEntry: 'Entry',
  onionRoutingPathRelay: 'Relay',
  /** Over the drawing of a path being built, before the client has any. */
  onionRoutingPathBuilding: 'Building paths',
  /** The flow's last column for a path to the file server, which lies past its last relay. */
  onionRoutingPathFileServer: 'File server',
  /**
   * The flow's legend: what each colour of path is for. Your swarm's paths carry your own
   * messages; other storage nodes' carry what goes to contacts and groups. Communities use the
   * catalogue's `conversationsCommunities`.
   */
  onionRoutingPathYourMessages: 'Your messages',
  onionRoutingPathContactsGroups: 'Contacts and groups',
  /**
   * How new messages reach the device: the mobile setting that replaced Fast and Slow Mode, with
   * four choices on Android and three on iOS. The names are to be reviewed with the team before
   * keys are added.
   */
  messageDelivery: 'Message delivery',
  messageDeliveryDescription:
    "Choose how new messages reach this device while you're not using Session.",
  /**
   * The push mode, named by the service the build uses; the generic one where the build names none.
   * Named by who carries the push rather than by speed, since Always connected is instant too.
   */
  deliveryPushGoogle: 'Google push',
  deliveryPushApple: 'Apple push',
  deliveryPushHuawei: 'Huawei push',
  deliveryPush: 'Push notifications',
  deliveryInstantDescriptionGoogle:
    'Instant, through Google. Google learns when a message arrives, not who sent it or what it says.',
  deliveryInstantDescriptionApple:
    'Instant, through Apple. Apple learns when a message arrives, not who sent it or what it says.',
  deliveryInstantDescriptionHuawei:
    'Instant, through Huawei. Huawei learns when a message arrives, not who sent it or what it says.',
  deliveryInstantDescription:
    "Instant, through your device's notification service. It learns when a message arrives, not who sent it or what it says.",
  /** Under Instant: communities have no push, so their messages wait for a background check. */
  deliveryInstantCommunities: 'Community messages arrive with periodic checks.',
  deliveryUnavailableBuild: "Push notifications aren't included in this build.",
  deliveryUnavailableDeviceGoogle: 'Not available on this device: it needs Google Play services.',
  deliveryUnavailableDeviceHuawei: 'Not available on this device: it needs Huawei Mobile Services.',
  deliveryUnavailableDevice: 'Not available on this device.',
  deliveryAlwaysConnected: 'Always connected',
  deliveryAlwaysConnectedDescription:
    'Instant, with a permanent notification. Session stays connected itself, so no one else is involved, but it uses more battery.',
  deliveryPeriodic: 'Periodic checks',
  deliveryPeriodicDescription:
    'Session checks for new messages now and then, when your device allows. Messages can arrive late.',
  deliveryWhileOpen: 'Only while open',
  deliveryWhileOpenDescription:
    "Nothing runs in the background. You'll see new messages when you open Session.",
  /** The Notifications page's warning when the OS does not let the app post notifications. */
  notificationsOffForSession: "Notifications are turned off for Session in your device's settings.",
  /** Android's "Run App in the Background", which says nothing about what it does. */
  backgroundActivityDescription:
    'Stops Android pausing Session to save battery, so background checks happen when they should.',
  /** iOS, when Background App Refresh is off for the app, by the delivery mode chosen. */
  backgroundRefreshOffPeriodic:
    "Background App Refresh is off for Session, so it can't check for new messages in the background.",
  backgroundRefreshOffInstant:
    "Background App Refresh is off for Session. Notifications still arrive, but the backup checks for missed messages can't run.",
  /** The Message Requests channel's row, beside the catalogue's lines for the other channels. */
  deviceSettingsMessageRequestNotifications:
    'Open Device Settings for Message Request Notifications.',
  /** The body of the notification Preview Notification posts when content is shown. */
  previewNotificationBody: 'This is how a message notification looks.',
  /**
   * The iOS notification sounds' names, which legacy iOS shows untranslated (its own TODO asks
   * whether they should be). `none` is not here: it is the catalogue's `none`.
   */
  notificationSoundNames: {
    note: 'Note',
    aurora: 'Aurora',
    bamboo: 'Bamboo',
    chord: 'Chord',
    circles: 'Circles',
    complete: 'Complete',
    hello: 'Hello',
    input: 'Input',
    keys: 'Keys',
    popcorn: 'Popcorn',
    pulse: 'Pulse',
    synth: 'Synth',
  },
} as const
