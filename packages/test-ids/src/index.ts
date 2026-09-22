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
  conversationList: {
    settings: 'conversation-list-settings',
    newConversation: 'conversation-list-new',
    screen: 'conversation-list',
    row: (index: number) => `conversation-row-${index}` as const,
    rowName: 'conversation-row-name',
    rowSnippet: 'conversation-row-snippet',
    rowUnreadBadge: 'conversation-row-unread',
    empty: 'conversation-list-empty',
  },
  conversation: {
    screen: 'conversation',
    header: 'conversation-header',
    headerName: 'conversation-header-name',
    back: 'conversation-back',
    messageRow: (index: number) => `message-row-${index}` as const,
    messageBody: 'message-body',
    messageState: 'message-state',
    messageRetry: 'message-retry',
    attachment: 'message-attachment',
    attachmentImage: 'message-attachment-image',
    attachmentName: 'message-attachment-name',
    attachmentState: 'message-attachment-state',
    attachmentProgress: 'message-attachment-progress',
    attachmentDownload: 'message-attachment-download',
    attachmentSave: 'message-attachment-save',
    attachmentPill: 'message-attachment-pill',
    attachmentFooter: 'message-attachment-footer',
    attachmentAction: 'message-attachment-action',
    attachmentViewGallery: 'message-attachment-view-gallery',
    attachmentViewList: 'message-attachment-view-list',
    mediaViewer: 'media-viewer',
    mediaViewerClose: 'media-viewer-close',
    mediaViewerPrevious: 'media-viewer-previous',
    mediaViewerNext: 'media-viewer-next',
    autoDownloadPrompt: 'auto-download-prompt',
    autoDownloadYes: 'auto-download-yes',
    autoDownloadNo: 'auto-download-no',
    composerInput: 'message-composer',
    sendButton: 'send-button',
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
    accountId: 'settings-account-id',
    copyAccountId: 'settings-copy-account-id',
    networkStatus: 'settings-network-status',
    clearData: 'settings-clear-data',
    confirmClearData: 'settings-confirm-clear-data',
    confirmClearDataButton: 'settings-confirm-clear-data-button',
    cancelClearData: 'settings-cancel-clear-data',
    cacheFolder: 'settings-cache-folder',
    cacheReveal: 'settings-cache-reveal',
    cacheLimit: 'settings-cache-limit',
    cacheLimitOption: (bytes: number) => `settings-cache-limit-${bytes}` as const,
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
    reason: 'startup-failed-reason',
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
    scanQrTab: 'onboarding-scan-qr-tab',
    scanQrPane: 'onboarding-scan-qr-pane',
    scanQrPreview: 'onboarding-scan-qr-preview',
    cameraAccess: 'onboarding-camera-access',

    notificationsScreen: 'onboarding-notifications-screen',
    notificationsOption: (mode: string) => `onboarding-notifications-${mode}` as const,

    loadingScreen: 'onboarding-loading-screen',
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
