import { useFontScale } from './useFontScale'

/**
 * The text size past which glyphs beside text stop growing with it: iOS's XXX Large, the largest
 * size outside the accessibility ones. Beyond it a glyph takes width the text needs to stay on one
 * line, and the text is what carries the meaning, so the text goes on growing and the glyph holds.
 */
export const GLYPH_MAX_SCALE = 1.353

/**
 * How much something grows with the system text size: with it, from the default up to `max`. For a
 * length that has to keep pace with text that is itself capped - pass the same cap.
 */
export function useCappedFontScale(max: number): number {
  return Math.min(Math.max(useFontScale(), 1), max)
}

/** How much a glyph beside text grows with the system text size: with it, up to XXX Large. */
export function useGlyphScale(): number {
  return useCappedFontScale(GLYPH_MAX_SCALE)
}

/**
 * How far text that labels something grows with the system text size: a button's label, a title, a
 * tab, a list row's name and subtitle, a footer line, a pill. Past about twice the default such
 * text wraps word by word and takes the screen from the content it labels, which is what the large
 * size is for, so it holds there while body text goes on growing.
 *
 * **One cap for all of it, deliberately.** Text that labels stops here and glyphs beside text stop
 * at `GLYPH_MAX_SCALE`; a component that looks cramped at the largest sizes is left cramped rather
 * than given a multiplier of its own. Where something would be pushed out of sight entirely, fix
 * the layout instead.
 */
export const LABEL_MAX_SCALE = 2
