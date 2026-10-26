import { describe, expect, it } from 'vitest'

import { MIN_HIT_TARGET } from '#src/buttonHitTarget'
import {
  FILE_GLYPH_SIDE,
  FILE_LEAD_WIDTH,
  FILE_ROW_CONTROL,
  fileLeadHeight,
  fileRowControl,
  fileRowHeight,
  fileRowTone,
} from '#src/fileRowState'
import { SPACING } from '@session/theme-tokens'
import { TILE_RADIUS_STEP } from '#src/attachmentTileStyle'
import { textHeight } from '#src/textHeight'

describe('a file row’s one control', () => {
  it('follows from the state, and says which verb it is', () => {
    // Not cached -> Download, cached -> Export. Two verbs and two glyphs: one moves bytes into the
    // cache, the other writes a file we already hold out to a folder somebody chose.
    expect(fileRowControl('idle')).toBe('cloudDownload')
    expect(fileRowControl('ready')).toBe('hardDriveDownload')
    expect(fileRowControl('idle')).not.toBe(fileRowControl('ready'))
  })

  it('offers nothing while a transfer runs, because nothing can stop one', () => {
    expect(fileRowControl('fetching')).toBe('progress')
  })

  it('offers nothing at all on a file the server will not hand out', () => {
    expect(fileRowControl('unavailable')).toBeNull()
  })

  it('is a retry and only a retry after a failure', () => {
    expect(fileRowControl('failed')).toBe('rotateCw')
  })
})

describe('a file row’s columns', () => {
  it('draws the control at the app’s floor for a touch target', () => {
    expect(FILE_ROW_CONTROL).toBe(MIN_HIT_TARGET)
  })

  it('leaves the format room beside the glyph rather than under a wider one', () => {
    expect(FILE_LEAD_WIDTH).toBeGreaterThanOrEqual(FILE_GLYPH_SIDE)
  })

  it('draws the glyph square at the smaller corner', () => {
    // The list's thumbnails are the same square, and an attachment tile below the step takes the
    // smaller radius - so a row of files and a row of pictures read as the same family.
    expect(FILE_GLYPH_SIDE).toBeLessThan(TILE_RADIUS_STEP)
  })
})

describe('a file row’s colours', () => {
  it('is red throughout after a failure', () => {
    expect(fileRowTone('failed')).toEqual({ name: 'danger', caption: 'danger', control: 'danger' })
  })

  it('says a file is unavailable in the caption alone', () => {
    expect(fileRowTone('unavailable')).toEqual({
      name: 'primary',
      caption: 'danger',
      control: 'primary',
    })
  })

  it('is at rest in every other state', () => {
    for (const state of ['idle', 'fetching', 'ready'] as const)
      expect(fileRowTone(state)).toEqual({
        name: 'primary',
        caption: 'secondary',
        control: 'primary',
      })
  })
})

describe('a file row’s height', () => {
  it('is the lead with its format line, inside the row’s padding, and holds the control', () => {
    expect(fileLeadHeight(1)).toBe(FILE_GLYPH_SIDE + SPACING['3xs'] + textHeight('caption', 1))
    expect(fileRowHeight(1)).toBe(2 * SPACING.xs + fileLeadHeight(1))
    expect(fileRowHeight(1) - 2 * SPACING.xs).toBeGreaterThanOrEqual(FILE_ROW_CONTROL)
  })

  it('grows the format line with the OS font scale', () => {
    expect(fileLeadHeight(2)).toBe(FILE_GLYPH_SIDE + SPACING['3xs'] + textHeight('caption', 1, 2))
    expect(fileRowHeight(1.5)).toBe(2 * SPACING.xs + fileLeadHeight(1.5))
  })

  it('holds the name and caption once they outgrow the lead', () => {
    const name = textHeight('body', 1, 3) + SPACING['3xs'] + textHeight('caption', 1, 3)
    expect(name).toBeGreaterThan(fileLeadHeight(3))
    expect(fileRowHeight(3)).toBe(2 * SPACING.xs + name)
  })
})
