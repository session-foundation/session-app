/**
 * English that has no catalogue key yet, quarantined in one file.
 *
 * Every other word a person reads comes from `@session/localization`, and
 * `tests/copy.contract.test.ts` enforces that across every screen. These three do not: the
 * attachment cache section needs them and the Crowdin set has nothing that fits, so they ship
 * as English in every locale until the keys land.
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
} as const
