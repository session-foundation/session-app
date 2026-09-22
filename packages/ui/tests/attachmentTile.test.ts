import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { RADII } from '@session/theme-tokens'
import { describe, expect, it } from 'vitest'

import { TILE_RADIUS_STEP, tileRadius } from '#src/attachmentTile'

describe('a tile’s corner', () => {
  it('takes the larger radius at the sizes an album draws', () => {
    // The five-up's quarters are about 100 at a desktop bubble's width and about 70 on a phone,
    // and the three-up's small tiles the same. All of them are the larger corner.
    expect(tileRadius(208)).toBe(RADII.md)
    expect(tileRadius(102)).toBe(RADII.md)
    expect(tileRadius(70)).toBe(RADII.md)
  })

  it('takes the smaller radius at the size a list draws', () => {
    // 12 on a 40 px square is most of its half-width, which reads as a squircle rather than as the
    // same tile drawn smaller.
    expect(tileRadius(40)).toBe(RADII.sm)
  })

  it('steps once, and at the boundary it names', () => {
    expect(tileRadius(TILE_RADIUS_STEP)).toBe(RADII.md)
    expect(tileRadius(TILE_RADIUS_STEP - 1)).toBe(RADII.sm)
    // Two steps and no more: three would stop the album's tiles and the list's thumbnails reading
    // as the same family, which is the whole reason there is one component.
    expect(new Set([tileRadius(1), tileRadius(40), tileRadius(64), tileRadius(400)]).size).toBe(2)
  })
})

/**
 * Read rather than rendered, the way `Icon.contract.test.ts` reads its source: this suite has no
 * DOM, and what is worth pinning here is a handful of decisions that a renderer would not check
 * either. Each of them is a bug with no visible symptom in the state anybody screenshots.
 */
const component = readFileSync(join(import.meta.dirname, '../src/AttachmentTile.tsx'), 'utf8')

describe('what a tile draws', () => {
  it('puts the hairline on the tile, not on what fills it', () => {
    // An inset ring on an inner element is square, and the tile's own clip then takes its corners
    // off instead of curving them - a tile whose corners look like they have gone missing.
    const root = component.slice(component.indexOf('<YStack'), component.indexOf('testID={testID}'))
    expect(root).toContain('borderWidth')
    expect(root).toContain('borderRadius={radius}')
  })

  it('draws the play mark and the duration only once the bytes are here', () => {
    // While a transfer is pending the set's own control is on screen, and a play glyph promising
    // playback beside it promises a different future about the same picture.
    expect(component).toContain("{here && kind === 'video' ?")
  })

  it('resolves on its own picture loading, not on anything it is told', () => {
    // Each tile arriving by itself is the per-item signal, and it costs nothing: a url is the
    // request, so the load is the transfer finishing. A tile waiting to be told would need the
    // set's state threaded into every one of them to say the same thing later.
    expect(component).toContain('onLoad')
    expect(component).toContain('const here = drawable && loaded')
  })

  it('keeps the placeholder underneath rather than swapping it out', () => {
    // Swapping leaves a frame where the tile holds nothing, which reads as a picture that failed.
    expect(component).toContain('opacity={loaded ? 1 : 0}')
  })

  it('takes the overflow count already worded', () => {
    // `@session/ui` imports no sibling but theme-tokens, test-ids and basic-types, so `andMore`
    // is out of reach and a number here would be a second place the plural rule lives.
    expect(component).toContain('overflowLabel')
    expect(component).not.toMatch(/\+\s*\{\s*overflow/)
  })
})
