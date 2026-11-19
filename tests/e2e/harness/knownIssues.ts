import type { AuditIssue } from './ISessionApp'
import type { FormFactor } from './MobileApp'

/** One per auditing spec: each sees its own set, and only that spec can tell one is fixed. */
export type Audit = 'catalog' | 'showcase-desktop' | 'showcase-android' | 'showcase-ios'

/**
 * Findings that are the app's and known, keyed `rule target`, each with why it stands.
 *
 * An entry here is a bug with a name, not a pass: it keeps the audit failing on anything new, and
 * once its audit stops finding it the entry must go, or the next regression of it passes unseen.
 */
/** Why a finding stands; `only` where the other form factor has no such element to draw. */
type Known = string | { why: string; only: FormFactor }

const KNOWN_ISSUES: Record<Audit, Readonly<Record<string, Known>>> = {
  catalog: {
    'color-contrast message-attachment-state':
      'textSecondary at caption size on a received bubble is 3.5 to 4.1:1 in every theme, under AA',
    'color-contrast message-attachment': 'the format line under a lead square: the same ink',
    'color-contrast message-attachment-show-all': "the roll's Show all count: the same ink",
    'color-contrast message-state':
      "our message's send state on a purple sent bubble, ocean themes, as fileRow.onAccent: 4.2:1",
    'color-contrast message-attachment-name':
      "a failed file's name in the danger ink on the attachment sheet, classic-light: 4.3:1",
    'color-contrast button.variants simple': 'its label on the ocean-light page: 3.3:1',
    'color-contrast button.onAccent cell': "a cell's pressed label on the red accent's fill: 2.6:1",
    'color-contrast fileRow.onAccent fetching': 'the same as idle',
    'color-contrast button.variants danger': 'the pressed label on the danger fill: 3.7 to 4.2:1',
    'color-contrast button.variants solid':
      "the label on the red accent's fill, ocean themes: 4.0:1",
    'color-contrast button.variants long': 'the same, on the long label',
    'color-contrast button.variants outlineAccent':
      "hovered or held, its label on the red accent's fill, as solid's: 4.1:1",
    'color-contrast fileRow.onAccent idle':
      'the caption on a purple sent bubble, ocean themes: 4.2:1',
    'color-contrast fileRow.onAccent failed': 'the same',
    'color-contrast fileRow.onAccent uploading': 'the same',
    'color-contrast fileRow.onAccent queued': 'the same',
    'color-contrast fileRow.onAccent uploaded': 'the same',
    'color-contrast fileRow.onAccent unsent': 'the same',
    'color-contrast fileRow.received idle':
      'the caption on a received bubble, as message-attachment-state: 4.1:1',
    'color-contrast fileRow.received fetching': 'the same',
    'color-contrast fileRow.received failed':
      'the danger ink on a received bubble in a light theme, as message-attachment-action: 3.6:1',
    'color-contrast catalog-settings-row-trailing':
      'a secondary value on a pressed row, classic-light: 4.1:1',
    'color-contrast catalog-settings-row-arabic': 'its trailing value on a pressed row: the same',
    'color-contrast catalog-settings-row-destructive':
      'the danger ink on a light page, at label size: 4.3:1',
    'color-contrast recovery-password-hide':
      "the danger ink on the settings card's surface, classic-light, as the settings row: 4.3:1",
    'color-contrast context-menu-item-delete':
      "the danger ink on the menu's card surface, classic-light, as the settings row: 4.3:1",
    'color-contrast avatar.sizes xl': 'white initials on a light avatar colour: 1.4 to 2.3:1',
    'color-contrast avatar.sizes 2xl': 'the same',
    'color-contrast avatar.sizes 3xl': 'the same',
    'color-contrast avatar.sizes emoji': 'the same',
    'color-contrast avatar.sizes arabic': 'the same',
    'color-contrast rail-settings': "the rail's avatar, drawn by the same component: 2.3:1",
    'color-contrast conversation-header-avatar': "the conversation header's avatar: the same",
    'color-contrast settings-avatar': 'the avatar at the top of Settings: the same, 2.3:1',
  },
  'showcase-desktop': {
    'color-contrast message-attachment-state':
      'textSecondary at caption size on a received bubble is 3.5 to 4.1:1 in every theme, under AA',
    'color-contrast message-attachment': 'the format line under a lead square: the same ink',
    'color-contrast message-attachment-show-all': "the roll's Show all count: the same ink",
  },
  'showcase-android': {
    'target-size message-attachment-show-all': 'a PressArea 32dp tall, with no hitSlop at all',
  },
  'showcase-ios': {
    'XCUIAccessibilityAuditTypeSufficientElementDescription message-attachment-tile':
      "a tile is named by its filename, which Apple's audit reads as no human-readable label",
    'target-size message-attachment-show-all': 'a PressArea 32pt tall, with no hitSlop at all',
  },
}

export const issueKey = (issue: AuditIssue) => `${issue.rule} ${issue.target}`

/**
 * What `audit` found that is not known, and what is known that it no longer finds. On a phone or a
 * tablet, an entry for the other form factor is neither allowed nor expected.
 */
export function auditVerdict(audit: Audit, found: Iterable<AuditIssue>, form?: FormFactor) {
  const issues = [...found]
  const known = new Set(
    Object.entries(KNOWN_ISSUES[audit])
      .filter(([, entry]) => typeof entry === 'string' || form === undefined || entry.only === form)
      .map(([key]) => key),
  )
  const keys = new Set(issues.map(issueKey))
  return {
    unknown: issues.filter((issue) => !known.has(issueKey(issue))),
    fixed: [...known].filter((key) => !keys.has(key)),
  }
}

/** One line per finding, for an assertion's message. */
export const describeIssues = (issues: readonly AuditIssue[]) =>
  issues.map((issue) => `  ${issueKey(issue)}: ${issue.message}`)
