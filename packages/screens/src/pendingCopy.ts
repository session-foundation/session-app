/**
 * English that has no catalogue key yet, quarantined in one file.
 *
 * Every other word a person reads comes from `@session/localization`, and
 * `tests/copy.contract.test.ts` enforces that across every screen. These do not: the attachment
 * cache section, the set's own count, the gallery/list toggle and the export verb need them and
 * the Crowdin set has nothing that fits, so they ship as English in every locale until the keys
 * land.
 *
 * Each name is the token it is destined for, so promoting one is a swap:
 * `PENDING_COPY.attachmentCache` becomes `tr('attachmentCache')` and the entry goes. Adding to
 * this is not a way around the rule - a new entry needs the same pull request against
 * session-localization that it would have needed anyway.
 */
export const PENDING_COPY = {
  attachmentCache: 'Attachment Cache',
  attachmentCacheReveal: 'Reveal',
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
  attachmentViewGallery: 'Gallery',
  attachmentViewList: 'List',
  /**
   * Writing a file we already hold out to a folder somebody chose.
   *
   * The catalogue has `save`, `saving` and `saved`, and every one of them is used for the
   * download as well - which is how the same word ends up on a row that has nothing and on a row
   * that has everything. The only Export in the set is `helpReportABugExportLogs`, which is
   * about logs.
   */
  export: 'Export',
  exporting: 'Exporting',
} as const
