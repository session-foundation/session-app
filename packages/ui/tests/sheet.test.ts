import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { RADII } from '@session/theme-tokens'
import { describe, expect, it } from 'vitest'

import { SHEET_MAX_HEIGHT, SHEET_MAX_WIDTH, SHEET_RADIUS } from '#src/sheet'

describe('a sheet’s metrics', () => {
  it('takes the corner the radius ladder names for a bottom sheet', () => {
    expect(SHEET_RADIUS).toBe(RADII.xl)
  })

  it('stops short of the whole window', () => {
    // What is left is both the thing that says this is over the conversation rather than a screen
    // somebody navigated to, and somewhere to tap that is obviously "out".
    expect(SHEET_MAX_HEIGHT).toBe('80%')
  })

  it('is wider than the alert, because it holds rows rather than a sentence', () => {
    // `Modal` caps at 360. A row is a thumbnail, a name, a size and a control.
    expect(SHEET_MAX_WIDTH).toBeGreaterThan(360)
  })
})

/** Read rather than rendered, the way the other contract suites here are: this suite has no DOM. */
const component = readFileSync(join(import.meta.dirname, '../src/Sheet.tsx'), 'utf8')

describe('what a sheet draws', () => {
  it('rounds the bottom corners only where something is under them', () => {
    // On a phone it is against the bottom of the window, where a rounded corner would show the
    // page through a notch of its own making.
    expect(component).toContain('borderBottomLeftRadius: SHEET_RADIUS')
    expect(component).toMatch(/wide\s*\?[\s\S]{0,120}borderBottomLeftRadius/)
  })

  it('keeps the footer out of the scroll', () => {
    // A long set would otherwise push the one control that acts on all of it off the bottom.
    expect(component).toMatch(/<\/ScrollView>[\s\S]*footer/)
  })

  it('pays the bottom inset where it is against the edge of the screen', () => {
    // A dialog is inset from every side already; a bottom sheet sits under the home indicator.
    expect(component).toContain('paddingBottom: insets.bottom')
  })

  it('keeps the scrim on a layer of its own', () => {
    // An opacity on a parent applies to every descendant, which would make the sheet translucent.
    expect(component).toMatch(/fullscreen[\s\S]{0,80}opacity=\{SHEET_SCRIM_OPACITY\}/)
  })
})
