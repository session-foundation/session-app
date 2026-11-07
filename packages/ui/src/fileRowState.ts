import { SPACING } from '@session/theme-tokens'

import { MIN_HIT_TARGET } from './buttonHitTarget'
import type { IconName } from './Icon.types'
import { textHeight } from './textHeight'

/**
 * What a file row can be doing.
 *
 * `idle` is also what a file already in the cache reads as: nothing records whether the bytes are
 * on this device, because asking for them is the answer. So a row starts at "download" even for a
 * file that is here, and the press that follows is instant.
 */
export type FileRowState =
  | 'idle'
  | 'fetching'
  | 'ready'
  | 'failed'
  | 'unavailable'
  /** A file of a message being sent, waiting for the ones before it: uploads go one at a time. */
  | 'queued'
  /** A file of a message being sent that is on the file server while the rest are not. */
  | 'uploaded'
  /** A file of a message that stopped sending before reaching it. Nothing is waiting on it. */
  | 'unsent'

/**
 * The square the glyph sits in. The list's thumbnail is the same size, so the two columns line up.
 */
export const FILE_GLYPH_SIDE = 40

/** Wide enough for the square and for a four-letter format under it. */
export const FILE_LEAD_WIDTH = 44

/** The trailing control, at the app's floor for a touch target rather than at the glyph's size. */
export const FILE_ROW_CONTROL = MIN_HIT_TARGET

/** Between the lead, the name and the control. */
export const FILE_ROW_GAP = SPACING.sm

/** The square with a format line under it, held whether or not the file has one, so rows align. */
export function fileLeadHeight(fontScale: number): number {
  return FILE_GLYPH_SIDE + SPACING['3xs'] + textHeight('caption', 1, fontScale)
}

/**
 * The row's height, for a list's `getItemLayout`: its tallest column inside its padding.
 *
 * The text grows with the OS font scale and the glyph and control do not, so past about 2.4 the
 * name column is the tallest.
 */
export function fileRowHeight(fontScale: number): number {
  const name =
    textHeight('body', 1, fontScale) + SPACING['3xs'] + textHeight('caption', 1, fontScale)
  return 2 * SPACING.xs + Math.max(fileLeadHeight(fontScale), name, FILE_ROW_CONTROL)
}

/**
 * What the row's one control offers, which follows from the state with no further rule.
 *
 * `null` where there is nothing to offer: an unavailable file cannot be fetched, and a running
 * transfer cannot be stopped because the bridge has no cancel. `'progress'` is the ring, drawn in
 * a disabled button.
 */
export function fileRowControl(state: FileRowState): IconName | 'progress' | null {
  switch (state) {
    case 'idle':
      return 'cloudDownload'
    case 'fetching':
      return 'progress'
    // Export, which is a different verb from Download and deliberately a different glyph: one
    // moves bytes into the cache, the other writes a file we hold out to a folder.
    case 'ready':
      return 'hardDriveDownload'
    case 'failed':
      return 'rotateCw'
    case 'unavailable':
    case 'queued':
    case 'uploaded':
    case 'unsent':
      return null
  }
}

/**
 * A glyph in the control's place where there is nothing to press, so a sending set reads at a
 * glance: which files are up and which are waiting. Decoration: the caption says the same.
 */
export function fileRowMarker(state: FileRowState): IconName | null {
  if (state === 'queued') return 'clock'
  if (state === 'uploaded') return 'check'
  return null
}

export type FileRowTone = 'primary' | 'danger'

/**
 * The colour of a row's control. Only a failure's retry is red: the name stays the body text and
 * the caption the muted text in every state, so a failure is said in words at the contrast every
 * other caption has, on the page and on either bubble.
 */
export function fileRowTone(state: FileRowState): FileRowTone {
  return state === 'failed' ? 'danger' : 'primary'
}
