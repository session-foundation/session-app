import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { MIN_HIT_TARGET } from '#src/buttonHitTarget'
import { FILE_GLYPH_SIDE, FILE_LEAD_WIDTH, FILE_ROW_CONTROL, fileRowControl } from '#src/fileRow'
import { TILE_RADIUS_STEP } from '#src/attachmentTile'

describe('a file row’s one control', () => {
  it('follows from the state, and says which verb it is', () => {
    // Not cached -> Download, cached -> Export. Two verbs and two glyphs: one moves bytes into the
    // cache, the other writes a file we already hold out to a folder somebody chose.
    expect(fileRowControl('idle')).toBe('download')
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

/** Read rather than rendered, the way `attachmentTile.test.ts` reads its source: no DOM here. */
const component = readFileSync(join(import.meta.dirname, '../src/FileRow.tsx'), 'utf8')

describe('what a file row draws', () => {
  it('splits the name into a run that may truncate and one that may not', () => {
    // A single `numberOfLines={1}` is what puts the ellipsis over the extension, which is the one
    // part of a filename somebody is scanning for.
    expect(component).toContain('flexShrink={1}')
    expect(component).toContain('flexShrink={0}')
    expect(component).toContain('{tail}')
  })

  it('addresses the name as one string rather than as its two runs', () => {
    // Split across two elements the name stops being one string: a screen reader announces two
    // fragments and a test reading the id gets the head alone, which is `itin` for `itinerary.pdf`.
    expect(component).toMatch(/<XStack[^>]*accessibilityLabel={filename} testID={testIDs\?\.name}/)
    expect(component).not.toMatch(/<Text[\s\S]{0,200}?testID={testIDs\?\.name}/)
  })

  it('takes its caption already worded', () => {
    // `@session/ui` imports no sibling but theme-tokens, test-ids and basic-types, so every
    // reading on that line - the size, the two counts, the reason - is worded by the caller.
    expect(component).not.toContain('@session/localization')
    expect(component).toContain('caption: string')
  })

  it('holds the control’s square in every state', () => {
    // Including the state with no control: a row whose trailing column appears when a transfer
    // ends re-wraps the name underneath it at that moment.
    expect(component).toContain('if (control === null) return <YStack {...square} />')
  })
})
