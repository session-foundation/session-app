export type InkTone = 'primary' | 'secondary' | 'danger' | 'link'

const PAGE_INK = {
  primary: '$textPrimary',
  secondary: '$textSecondary',
  danger: '$dangerColor',
  link: '$accentText',
} as const satisfies Record<InkTone, string>

/**
 * The colour of text or a glyph in a given tone, on the page or on an accent fill such as a
 * bubble you sent.
 *
 * On the accent every tone is an on-colour: red or an accent-coloured link on the accent is
 * unreadable, so a failure has to be said by its words and glyph alone there.
 */
export function inkFor(
  tone: InkTone,
  onAccent: boolean,
): { color: (typeof PAGE_INK)[InkTone] | '$onAccent' | '$onAccentSecondary' } {
  if (!onAccent) return { color: PAGE_INK[tone] }
  return { color: tone === 'secondary' ? '$onAccentSecondary' : '$onAccent' }
}
