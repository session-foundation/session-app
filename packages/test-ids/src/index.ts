/**
 * Every element a test needs to address, named once.
 *
 * The same string is the component's `testID` and the test's selector on all three
 * platforms: react-native surfaces it as an Android resource-id and an iOS
 * accessibilityIdentifier, react-native-web renders it as `data-testid`. Because this repo
 * owns every client, there is no per-platform locator table to keep in step - and if a
 * mapping ever needs an exception, it belongs in the harness's resolver, not here.
 *
 * None of these are user-visible: screen readers announce labels and text, not identifiers,
 * and release builds strip the attribute entirely (QA builds keep it).
 *
 * An element a test cannot address is a missing entry here plus a missing `testID` on the
 * component. It is never a reason to reach for an xpath.
 */
export const ELEMENT = {
  /** The column down the side of a wide layout, beside the conversation list. */
  rail: {
    screen: 'rail',
    settings: 'rail-settings',
    pathStatus: 'rail-path-status',
    update: 'rail-update',
    themeToggle: 'rail-theme-toggle',
    /**
     * A rail item's tooltip, by the item's own name: `settings`, `update`, `path-status`,
     * `theme-toggle`.
     */
    tooltip: (item: string) => `rail-tooltip-${item}` as const,
  },
  conversationList: {
    /** The account's avatar on one pane, which opens settings; a wide layout has the rail's. */
    settings: 'conversation-list-settings',
    settingsPathStatus: 'conversation-list-settings-path-status',
    newConversation: 'conversation-list-new',
    screen: 'conversation-list',
    row: (index: number) => `conversation-row-${index}` as const,
    rowName: 'conversation-row-name',
    rowSnippet: 'conversation-row-snippet',
    rowUnreadBadge: 'conversation-row-unread',
    rowMarkedUnread: 'conversation-row-marked-unread',
    rowUnreadStrip: 'conversation-row-unread-strip',
    rowTime: 'conversation-row-time',
    rowPinned: 'conversation-row-pinned',
    rowMuted: 'conversation-row-muted',
    empty: 'conversation-list-empty',
  },
  conversation: {
    screen: 'conversation',
    header: 'conversation-header',
    headerName: 'conversation-header-name',
    headerAvatar: 'conversation-header-avatar',
    back: 'conversation-back',
    messageRow: (index: number) => `message-row-${index}` as const,
    dateHeader: 'conversation-date-header',
    messageBody: 'message-body',
    messageState: 'message-state',
    messageRetry: 'message-retry',
    messageQuote: 'message-quote',
    messageQuoteThumbnail: 'message-quote-thumbnail',
    messageHighlight: 'message-highlight',
    scrollToLatest: 'conversation-scroll-to-latest',
    firstPageRetry: 'conversation-first-page-retry',
    olderPageLoading: 'conversation-older-page-loading',
    olderPageRetry: 'conversation-older-page-retry',
    attachment: 'message-attachment',
    attachmentTile: 'message-attachment-tile',
    attachmentLead: 'message-attachment-lead',
    attachmentImage: 'message-attachment-image',
    attachmentName: 'message-attachment-name',
    attachmentState: 'message-attachment-state',
    attachmentProgress: 'message-attachment-progress',
    attachmentDownload: 'message-attachment-download',
    attachmentExport: 'message-attachment-export',
    attachmentRetry: 'message-attachment-retry',
    attachmentShowAllFailed: 'message-attachment-show-all-failed',
    attachmentFetch: 'message-attachment-fetch',
    attachmentFooter: 'message-attachment-footer',
    attachmentAction: 'message-attachment-action',
    attachmentViewGallery: 'message-attachment-view-gallery',
    attachmentViewList: 'message-attachment-view-list',
    attachmentShowAll: 'message-attachment-show-all',
    attachmentSheet: 'message-attachment-sheet',
    attachmentSheetClose: 'message-attachment-sheet-close',
    attachmentSheetScrim: 'message-attachment-sheet-scrim',
    attachmentSheetList: 'message-attachment-sheet-list',
    mediaViewer: 'media-viewer',
    mediaViewerClose: 'media-viewer-close',
    mediaViewerExport: 'media-viewer-export',
    mediaViewerImage: 'media-viewer-image',
    mediaViewerPrevious: 'media-viewer-previous',
    mediaViewerNext: 'media-viewer-next',
    mediaViewerPreparing: 'media-viewer-preparing',
    exportAccessDialog: 'export-access-dialog',
    exportAccessSettings: 'export-access-settings',
    exportAccessCancel: 'export-access-cancel',
    autoDownloadPrompt: 'auto-download-prompt',
    autoDownloadYes: 'auto-download-yes',
    autoDownloadNo: 'auto-download-no',
    autoDownloadClose: 'auto-download-close',
    autoDownloadOption: (mode: string) => `auto-download-${mode}` as const,
    composerInput: 'message-composer',
    sendButton: 'send-button',
    attachButton: 'composer-attach',
    attachMenu: 'composer-attach-menu',
    attachMenuClose: 'composer-attach-menu-close',
    attachMenuScrim: 'composer-attach-menu-scrim',
    attachMedia: 'composer-attach-media',
    attachDocument: 'composer-attach-document',
    stagedTray: 'composer-staged',
    stagedTile: (index: number) => `composer-staged-${index}` as const,
    stagedRemove: (index: number) => `composer-staged-remove-${index}` as const,
    stagedPreview: (index: number) => `composer-staged-preview-${index}` as const,
    stagedClear: 'composer-staged-clear',
    stagedAdd: 'composer-staged-add',
    composerNotice: (kind: string) => `composer-notice-${kind}` as const,
    composerReply: 'composer-reply',
    composerReplyClose: 'composer-reply-close',
    composerReplyThumbnail: 'composer-reply-thumbnail',
    composerNoticeDismiss: (kind: string) => `composer-notice-dismiss-${kind}` as const,
    dropOverlay: 'conversation-drop-overlay',
  },
  requests: {
    screen: 'requests',
    back: 'requests-back',
    row: (index: number) => `request-row-${index}` as const,
    accept: (index: number) => `request-accept-${index}` as const,
    badge: 'requests-badge',
  },
  settings: {
    screen: 'settings',
    back: 'settings-back',
    themePicker: 'settings-theme-picker',
    themeOption: (name: string) => `settings-theme-${name}` as const,
    accentOption: (name: string) => `settings-accent-${name}` as const,
    displayName: 'settings-display-name',
    /** The account's display picture, which enlarges in place when pressed. */
    avatar: 'settings-avatar',
    /** The badge on the display picture that puts the account's QR code in its place. */
    qrToggle: 'settings-qr-toggle',
    /** The badge on the QR code that brings the display picture back. */
    qrBack: 'settings-qr-back',
    accountQr: 'settings-account-qr',
    accountQrFullScreen: 'settings-account-qr-full-screen',
    accountId: 'settings-account-id',
    copyAccountId: 'settings-copy-account-id',
    shareAccountId: 'settings-share-account-id',
    tokenLogo: 'settings-token-logo',
    networkStatus: 'settings-network-status',
    pathStatus: 'settings-path-status',
    pathScreen: 'settings-path-screen',
    pathFlow: 'settings-path-flow',
    pathLearnMore: 'settings-path-learn-more',
    pathStat: (name: string) => `settings-path-stat-${name}` as const,
    clearData: 'settings-clear-data',
    confirmClearData: 'settings-confirm-clear-data',
    confirmClearDataButton: 'settings-confirm-clear-data-button',
    cancelClearData: 'settings-cancel-clear-data',
    cacheFolder: 'settings-cache-folder',
    cacheUsage: 'settings-cache-usage',
    cacheLimit: 'settings-cache-limit',
    modal: 'settings-modal',
    modalClose: 'settings-modal-close',
    modalBack: 'settings-modal-back',
    /** A root-list row, keyed by where it leads rather than by position. */
    row: (name: string) => `settings-row-${name}` as const,
    /** The version stamp, which is also the debug-mode control. */
    version: 'settings-version',
    commit: 'settings-commit',
  },
  help: {
    reportABug: 'help-report-a-bug',
    exportLogs: 'help-export-logs',
    link: (name: string) => `help-link-${name}` as const,
    keyboardShortcuts: 'help-keyboard-shortcuts',
  },
  keyboardShortcuts: {
    page: 'keyboard-shortcuts',
    /** A shortcut's row, by what it does; see `keyboardShortcuts` in the screens package. */
    row: (name: string) => `keyboard-shortcut-${name}` as const,
    /** One of a row's key combinations, in the order drawn. */
    combo: (name: string, index: number) => `keyboard-shortcut-${name}-${String(index)}` as const,
  },
  recoveryPassword: {
    words: 'recovery-password-words',
    copy: 'recovery-password-copy',
    viewQr: 'recovery-password-view-qr',
    viewWords: 'recovery-password-view-words',
    qr: 'recovery-password-qr',
    qrFullScreen: 'recovery-password-qr-full-screen',
    hideRow: 'recovery-password-hide-row',
    hide: 'recovery-password-hide',
    hideConfirm: 'recovery-password-hide-confirm',
    hideContinue: 'recovery-password-hide-continue',
    hideYes: 'recovery-password-hide-yes',
    hideCancel: 'recovery-password-hide-cancel',
    loadError: 'recovery-password-load-error',
  },
  toast: {
    item: 'toast',
    close: 'toast-close',
  },
  networkOverlay: {
    badge: 'network-overlay-badge',
  },
  newConversation: {
    screen: 'new-conversation',
    back: 'new-conversation-back',
    accountIdInput: 'new-conversation-account-id',
    start: 'new-conversation-start',
    error: 'new-conversation-error',
  },

  starting: {
    screen: 'starting',
    slowMessage: 'starting-slow-message',
    slowDialog: 'starting-slow-dialog',
    slowDialogClose: 'starting-slow-dialog-close',
  },

  startupFailed: {
    screen: 'startup-failed',
    explanation: 'startup-failed-explanation',
    reason: 'startup-failed-reason',
    copyReason: 'startup-failed-copy-reason',
    exportLogs: 'startup-failed-export-logs',
    clear: 'startup-failed-clear',
    quit: 'startup-failed-quit',
    confirmClear: 'startup-failed-confirm-clear',
    confirmClearButton: 'startup-failed-confirm-clear-button',
    cancelClear: 'startup-failed-cancel-clear',
  },

  languagePicker: {
    trigger: 'language-picker',
    panel: 'language-picker-panel',
    search: 'language-picker-search',
    close: 'language-picker-close',
    option: (locale: string) => `language-picker-option-${locale}` as const,
  },

  onboarding: {
    screen: 'onboarding',
    back: 'onboarding-back',
    createAccount: 'onboarding-create-account',
    restoreAccount: 'onboarding-restore-account',
    hero: 'onboarding-hero',
    faqLink: 'onboarding-faq-link',
    websiteLink: 'onboarding-website-link',
    termsOfService: 'onboarding-tos',
    openUrlDialog: 'onboarding-open-url',
    openUrlConfirm: 'onboarding-open-url-confirm',
    copyUrl: 'onboarding-copy-url',
    openTerms: 'onboarding-open-terms',
    openPrivacy: 'onboarding-open-privacy',
    openUrlCancel: 'onboarding-open-url-cancel',
    continueButton: 'onboarding-continue',

    displayNameScreen: 'onboarding-display-name-screen',
    displayNameInput: 'onboarding-display-name',
    displayNameError: 'onboarding-display-name-error',
    displayNameCounter: 'onboarding-display-name-counter',

    loadAccountScreen: 'onboarding-load-account-screen',
    recoveryPhraseInput: 'onboarding-recovery-phrase',
    recoveryPhraseReveal: 'onboarding-recovery-phrase-reveal',
    recoveryPhraseError: 'onboarding-recovery-phrase-error',
    recoveryPhraseTab: 'onboarding-recovery-phrase-tab',
    exportLogs: 'onboarding-export-logs',
    scanQrTab: 'onboarding-scan-qr-tab',
    scanQrPane: 'onboarding-scan-qr-pane',
    scanQrPreview: 'onboarding-scan-qr-preview',
    cameraAccess: 'onboarding-camera-access',
    cameraSettingsDialog: 'onboarding-camera-settings',
    cameraSettingsOpen: 'onboarding-camera-settings-open',
    cameraSettingsCancel: 'onboarding-camera-settings-cancel',

    notificationsScreen: 'onboarding-notifications-screen',
    notificationsOption: (mode: string) => `onboarding-notifications-${mode}` as const,

    loadingScreen: 'onboarding-loading-screen',
  },
  /** Whichever context menu is open: only one ever is. */
  contextMenu: {
    menu: 'context-menu',
    submenu: 'context-menu-submenu',
    back: 'context-menu-back',
    /** A row, by its entry's id: `reply`, `copy`, `delete`. */
    item: (id: string) => `context-menu-item-${id}` as const,
  },
  /** Whichever full-screen QR code is open: only one ever is. */
  qrViewer: {
    close: 'qr-viewer-close',
    /** The button under the code that hands it to the share sheet, on the phones. */
    share: 'qr-viewer-share',
  },
  catalog: {
    page: 'catalog-page',
    ready: 'catalog-ready',
    cell: (page: string, row: string, column: string) =>
      `catalog-cell-${page}-${row}-${column}` as const,
  },
} as const

/**
 * Every id the registry can produce, including the parameterised ones.
 *
 * **Read off `ELEMENT` rather than listed beside it.** A hand-written union is a second copy of
 * the registry, and the two drift in one direction only: an id added above and forgotten here is
 * an element the e2e harness cannot name, because every locator it takes is typed as this. That
 * had happened to 36 of them. Derived, the two cannot disagree.
 */
export type ElementId = IdsIn<typeof ELEMENT>

/** A string leaf, the return type of a parameterised one, or the union of a group's members. */
type IdsIn<T> = T extends string
  ? T
  : T extends (...args: never[]) => infer R
    ? R
    : T extends object
      ? { [K in keyof T]: IdsIn<T[K]> }[keyof T]
      : never
