/**
 * How far secondary text on an accent fill may dim `$onAccent`.
 *
 * Dimming spends the 4.5:1 the token is derived to clear, and Ocean Light's starts lowest, at
 * 8.49:1; 0.85 is about the floor at caption size. See THEMING.md on dimming an on-colour.
 */
export const ON_ACCENT_SECONDARY_OPACITY = 0.85

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
 * On the accent every tone is `$onAccent`: red or an accent-coloured link on the accent is
 * unreadable, so a failure has to be said by its words and glyph alone there.
 */
export function inkFor(
  tone: InkTone,
  onAccent: boolean,
): { color: (typeof PAGE_INK)[InkTone] | '$onAccent'; opacity: number } {
  if (!onAccent) return { color: PAGE_INK[tone], opacity: 1 }
  return { color: '$onAccent', opacity: tone === 'secondary' ? ON_ACCENT_SECONDARY_OPACITY : 1 }
}
