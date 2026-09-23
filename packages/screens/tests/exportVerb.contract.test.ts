import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { tr } from '@session/localization'
import { describe, expect, it } from 'vitest'

import { PENDING_COPY } from '#src/pendingCopy'

/**
 * Downloading and exporting are two things and must never be one word.
 *
 * They were: the catalogue's `save` sat on a row with nothing on the device and on a row with
 * everything, so the control said the same thing whether it was about to fetch a file or write
 * one out. Nothing failed and nothing looked broken - the word was simply wrong half the time,
 * which is the shape of defect that survives every pass that is not looking for it.
 */
describe('the two verbs', () => {
  it('are different words', () => {
    expect(PENDING_COPY.export).not.toBe(tr('download'))
    expect(PENDING_COPY.exporting).not.toBe(tr('downloading'))
  })

  it('are not the catalogue’s save, which means both', () => {
    // If a key called `export` ever lands, this is the entry that goes - not the one that is
    // quietly pointed back at `save`.
    expect(PENDING_COPY.export).not.toBe(tr('save'))
    expect(PENDING_COPY.exporting).not.toBe(tr('saving'))
  })
})

const row = readFileSync(join(import.meta.dirname, '../src/AttachmentRow.tsx'), 'utf8')
const footer = readFileSync(join(import.meta.dirname, '../src/AttachmentFooter.tsx'), 'utf8')
const viewer = readFileSync(join(import.meta.dirname, '../src/MessageMediaViewer.tsx'), 'utf8')

describe('where a file can be written out', () => {
  it('says Export in every one of them', () => {
    // Three surfaces offer it - the row's control, the footer's action and the viewer's - and a
    // fourth word appearing on one of them is how they drift apart again.
    for (const source of [row, footer, viewer]) expect(source).toContain('PENDING_COPY.export')
  })

  it('leaves no save verb behind', () => {
    for (const source of [row, footer, viewer]) {
      expect(source).not.toMatch(/tr\('sav(e|ing)'\)/)
    }
  })
})
