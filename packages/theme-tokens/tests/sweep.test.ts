import { describe, expect, it } from 'vitest'

import { PRIMARY_COLOR_HEX } from '#src/colors'
import type { PrimaryColorState, ThemeState } from '#src/colors'
import { hexToOklch } from '#src/oklch'
import { MIN_SEMANTIC_CHROMA, baseFits, contrastRatio } from '#src/rules'
import { deriveTokens, getThemeKnobs, knobsFor } from '#src/themeTokens'
import type { ThemeTokens } from '#src/themeTokens'

/**
 * The derivation swept across every theme, accent and a spread of plausible custom bases.
 *
 * A unit test can only say a rule works on the four themes we happen to ship. This says it works on
 * a base a user picks, which is the case the whole knobs model exists for -- and it is what caught
 * the defect that four separate unit tests had missed: a role measured against the base while being
 * drawn on a card. `textSecondary` was at 3.9:1 on a feature-row description while measuring 4.6
 * against a page nothing was drawn on.
 */

const THEMES: ThemeState[] = ['classic-dark', 'classic-light', 'ocean-dark', 'ocean-light']
const ACCENTS = Object.keys(PRIMARY_COLOR_HEX) as PrimaryColorState[]

/** Bases a person might plausibly land on, including two that are deliberately awkward. */
const BASES = [
  '#FFFFFF',
  '#FCFFFF',
  '#FBF7F2',
  '#F4F6FF',
  '#EFEFEF',
  '#1B1B1B',
  '#000000',
  '#1A1C28',
  '#141B2E',
  '#22181F',
  '#0E1712',
  '#2A2A2E',
]

const surfaces = (t: ThemeTokens): string[] => [
  t.backgroundPrimary,
  t.backgroundSecondary,
  t.backgroundTertiary,
  t.backgroundNested,
]

/** Role, the surfaces it can be drawn on, and the floor it must clear on all of them. */
const CHECKS: [keyof ThemeTokens, (t: ThemeTokens) => string[], number][] = [
  ['textPrimary', surfaces, 4.5],
  ['textSecondary', (t) => [...surfaces(t), t.messageBubbleIncomingBg], 4.5],
  ['accentText', surfaces, 4.5],
  ['dangerColor', surfaces, 4.5],
  ['warningColor', surfaces, 4.5],
  ['textDisabled', surfaces, 2],
  // Text contrast, because both are only ever button labels.
  ['onAccent', (t) => [t.primaryColor], 4.5],
  ['onAccentSecondary', (t) => [t.primaryColor], 4.5],
  ['onDanger', (t) => [t.dangerColor], 4.5],
  ['messageBubbleIncomingText', (t) => [t.messageBubbleIncomingBg], 4.5],
]

function shortfalls(tokens: ThemeTokens, label: string): string[] {
  const out: string[] = []
  for (const [role, against, min] of CHECKS) {
    for (const surface of against(tokens)) {
      const ratio = contrastRatio(tokens[role], surface)
      if (ratio < min) out.push(`${label}: ${role} ${ratio.toFixed(2)} < ${min}`)
    }
  }
  return out
}

/**
 * Whether two colours risk collapsing together for a red-green colour-blind viewer.
 *
 * A separate question from `confusable`, and it has to be, because the discriminators do not
 * transfer. Chroma separates a saturated yellow from white for anyone -- but red and amber both sit
 * on the axis a protanope or deuteranope cannot resolve, so a saturation difference between them
 * buys nothing. What is left is lightness, and if that matches too, the pair is gone.
 *
 * Hence the arc: anything from red through to yellow, judged on lightness alone.
 */
function redGreenRisk(a: string, b: string): boolean {
  const oa = hexToOklch(a)
  const ob = hexToOklch(b)
  const onAxis = (h: number) => h >= 15 && h <= 105
  if (!onAxis(oa.h) || !onAxis(ob.h)) return false
  return Math.abs(oa.l - ob.l) < 0.15
}

describe('derivation sweep', () => {
  it('has no contrast shortfall on any theme, accent or plausible base', () => {
    const found: string[] = []

    for (const theme of THEMES) {
      // Authored reds and ambers are excluded deliberately: their shortfall is a recorded decision
      // pinned by its own test in rules.test.ts, not a regression for this sweep to re-find. What
      // is under test here is the derivation.
      const { semantic: _authored, ...knobs } = getThemeKnobs(theme)
      for (const accent of ACCENTS) {
        found.push(
          ...shortfalls(deriveTokens(knobs, PRIMARY_COLOR_HEX[accent]), `${theme}/${accent}`),
        )
      }
    }

    // Valid bases only. An invalid base cannot carry a full palette -- that is what makes it
    // invalid -- so what it owes is graceful degradation, asserted separately below.
    for (const base of BASES) {
      for (const accent of ACCENTS) {
        const hex = PRIMARY_COLOR_HEX[accent]
        const knobs = knobsFor(base, hex)
        if (!baseFits(base, knobs.polarity)) continue
        found.push(...shortfalls(deriveTokens(knobs, hex), `${base}/${accent}`))
      }
    }

    expect(found).toEqual([])
  })

  it('records what the border roles measure, which is below the 3:1 a control boundary owes', () => {
    // **The one pair with a WCAG obligation is the one no floor covers.** 1.4.11 asks 3:1 of the
    // visual boundary of a control where that boundary is what identifies it, and none of these
    // clears it. They are the shipped values, so this records them rather than asserting a floor
    // they would fail -- which is what makes the next change to them a deliberate one. Raising
    // them is a design decision; see the borders note in THEMING.md.
    const measured = THEMES.map((theme) => {
      const t = deriveTokens(getThemeKnobs(theme), PRIMARY_COLOR_HEX.green)
      const against = (hex: string) => contrastRatio(hex, t.backgroundPrimary).toFixed(2)
      return `${theme} borders ${against(t.bordersColor)} separator ${against(t.separatorColor)}`
    })

    expect(measured).toEqual([
      'classic-dark borders 1.79 separator 2.19',
      'classic-light borders 1.35 separator 1.44',
      'ocean-dark borders 1.84 separator 2.16',
      'ocean-light borders 2.59 separator 1.44',
    ])
  })

  it('keeps semantic colours recognisable even on a base that cannot carry them', () => {
    // The failure this replaces: on a saturated base the amber was driven to #fdfdfd -- 4.56:1 and
    // white. It scored well and it was invisible, because contrast was the only thing being asked
    // for. On a base this hostile the palette cannot be guaranteed, but a warning that no longer
    // looks like a warning is worse than one with less contrast, so chroma is what is held.
    const colourless: string[] = []
    for (const base of ['#028804', '#E10E0E', '#A45A41', '#9AA1CB', '#2A2A2E', '#B8860B']) {
      const hex = PRIMARY_COLOR_HEX.green
      const knobs = knobsFor(base, hex)
      expect(baseFits(base, knobs.polarity)).toBe(false)
      const t = deriveTokens(knobs, hex)
      for (const [name, role] of [
        ['danger', t.dangerColor],
        ['warning', t.warningColor],
      ] as const) {
        if (hexToOklch(role).c < 0.05) colourless.push(`${base}: ${name} ${role}`)
      }
    }
    expect(colourless).toEqual([])
  })

  it('covers every accent against every theme and base', () => {
    expect(ACCENTS.length * (THEMES.length + BASES.length)).toBe(112)
  })

  it('keeps semantic colours distinct from text, which is what they actually owe', () => {
    // Not distinct from each other -- danger and warning are allowed to resemble each other, and
    // both light presets already ship a pair that does. What neither may do is resemble a
    // paragraph, and since text is achromatic that is a question about chroma.
    const dull: string[] = []
    for (const base of BASES) {
      const hex = PRIMARY_COLOR_HEX.green
      const knobs = knobsFor(base, hex)
      if (!baseFits(base, knobs.polarity)) continue
      const t = deriveTokens(knobs, hex)
      for (const [name, role] of [
        ['danger', t.dangerColor],
        ['warning', t.warningColor],
      ] as const) {
        if (hexToOklch(role).c < MIN_SEMANTIC_CHROMA) dull.push(`${base}: ${name} ${role}`)
      }
    }
    expect(dull).toEqual([])
  })

  it('gives light themes an amber at least as saturated as the one that ships', () => {
    // The shipped light amber #A64B00 measures 0.139. Deriving one is not supposed to be a
    // downgrade, and the earlier rule made it 0.074 -- a brown.
    for (const base of ['#FFFFFF', '#FCFFFF', '#F7F4EE']) {
      const t = deriveTokens(knobsFor(base, PRIMARY_COLOR_HEX.green), PRIMARY_COLOR_HEX.green)
      expect(hexToOklch(t.warningColor).c).toBeGreaterThan(0.13)
    }
  })

  it('records that danger and warning sit on the same colour-blind axis', () => {
    // Recorded, not required. Both shipped light presets already do this, and the derivation now
    // does too by design: keeping the vivid red and the amber matters more than separating a pair
    // whose meaning is carried by the words next to it. Pinned so the choice stays visible.
    const risky: string[] = []
    for (const base of BASES) {
      const hex = PRIMARY_COLOR_HEX.green
      const knobs = knobsFor(base, hex)
      if (!baseFits(base, knobs.polarity)) continue
      const t = deriveTokens(knobs, hex)
      if (redGreenRisk(t.dangerColor, t.warningColor)) risky.push(base)
    }
    expect(risky.length).toBeGreaterThan(0)
  })
})

describe('default accent', () => {
  it('matches the accent each theme thumbnail bakes in', () => {
    // Sampled from a real Session 1.34.0 Appearance screen: the Classic pair previews green, the
    // Ocean pair blue, and selecting a theme applies it.
    expect(getThemeKnobs('classic-dark').defaultAccent).toBe(PRIMARY_COLOR_HEX.green)
    expect(getThemeKnobs('classic-light').defaultAccent).toBe(PRIMARY_COLOR_HEX.green)
    expect(getThemeKnobs('ocean-dark').defaultAccent).toBe(PRIMARY_COLOR_HEX.blue)
    expect(getThemeKnobs('ocean-light').defaultAccent).toBe(PRIMARY_COLOR_HEX.blue)
  })

  it('starts a custom theme on the accent it was built from', () => {
    expect(knobsFor('#1B1B1B', PRIMARY_COLOR_HEX.purple).defaultAccent).toBe(
      PRIMARY_COLOR_HEX.purple,
    )
  })
})
