import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Read rather than rendered, following `Icon.contract.test.ts`: this package has no DOM
 * environment.
 *
 * The hazard is structural, so the source is enough to see it. `color` on the frame -- a
 * `styled(XStack)`, a View -- reaches a `Text` on neither platform by itself, so a variant can
 * change the ground under its label and leave the label behind while looking correct in the table.
 */
const source = readFileSync(join(import.meta.dirname, '../src/Button.tsx'), 'utf8')

/**
 * The surface ladder, which body text is derived to clear on every rung.
 *
 * A state that moves the button between these does *not* have to restate the label colour:
 * `textPrimary` and `textSecondary` are adjusted against all four, so the resting label reads on
 * any of them. Filling with `$textPrimary` or `$primaryColor` is a different act -- those are not
 * surfaces, and nothing guarantees a label against them.
 */
const SURFACES = [
  '$backgroundPrimary',
  '$backgroundSecondary',
  '$backgroundTertiary',
  '$backgroundNested',
]

/** Laid over a surface, not replacing it; theme-tokens' `overlays.test.ts` keeps text readable. */
const OVERLAYS = ['$hoverOverlay', '$pressedOverlay']

/** Whether a state's declared background leaves the surface ladder. */
function leavesTheLadder(declared: string): boolean {
  const fill = /backgroundColor: '(\$\w+)'/.exec(declared)?.[1]
  return fill !== undefined && !SURFACES.includes(fill) && !OVERLAYS.includes(fill)
}

/** The body of each `variant:` entry, keyed by name. */
function variants(): Map<string, string> {
  const block = /variant: \{\n([\s\S]*?)\n {4}\},\n {4}size:/.exec(source)?.[1] ?? ''
  const out = new Map<string, string>()
  // Entries are at a fixed indent, so the next one at that indent ends the previous.
  const starts = [...block.matchAll(/^ {6}(\w+): \{$/gm)]
  starts.forEach((m, i) => {
    const from = m.index + m[0].length
    const to = i + 1 < starts.length ? (starts[i + 1]?.index ?? block.length) : block.length
    out.set(m[1] as string, block.slice(from, to))
  })
  return out
}

/**
 * Each variant's entry in `PRESS_STYLE`, keyed by name: the one table both the web's `pressStyle`
 * and native's `PRESSED` are taken from.
 */
function pressStyles(): Map<string, string> {
  const block = /const PRESS_STYLE = \{\n([\s\S]*?)\n\} as const/.exec(source)?.[1] ?? ''
  const out = new Map<string, string>()
  for (const m of block.matchAll(/^ {2}(\w+): \{([\s\S]*?)\},$/gm))
    out.set(m[1] as string, m[2] as string)
  return out
}

describe('every Button variant', () => {
  const found = variants()
  const presses = pressStyles()

  /** A state's declared style: the press from the shared table, the hover from the variant. */
  function declaredState(name: string, body: string, state: 'hoverStyle' | 'pressStyle') {
    return state === 'pressStyle'
      ? presses.get(name)
      : new RegExp(`${state}: \\{([^}]*)\\}`).exec(body)?.[1]
  }

  it('is found by this test at all, so a rename cannot make it vacuous', () => {
    expect([...found.keys()]).toEqual([
      'solid',
      'outline',
      'outlineAccent',
      'ghost',
      'ghostAccent',
      'simple',
      'tonal',
      'danger',
    ])
  })

  it('takes its web press style from the shared table, so native cannot differ', () => {
    expect([...presses.keys()]).toEqual([...found.keys()])
    const inline = [...found].filter(
      ([name, body]) => !body.includes(`pressStyle: PRESS_STYLE.${name},`),
    )
    expect(inline.map(([name]) => name)).toEqual([])
  })

  it('declares its resting label colour on the frame, which is what the web label inherits', () => {
    const missing = [...found].filter(([, body]) => !/^\s+color: '\$\w+',$/m.test(body))
    expect(missing.map(([name]) => name)).toEqual([])
  })

  /**
   * A state that fills with something off the surface ladder has to say what the label becomes.
   *
   * A state that shifts opacity, or moves between surfaces, does not: the resting label reads
   * against both.
   */
  it('says what its label becomes wherever it fills with something off the surface ladder', () => {
    const offenders: string[] = []
    for (const [name, body] of found) {
      for (const state of ['hoverStyle', 'pressStyle'] as const) {
        const declared = declaredState(name, body, state)
        if (declared === undefined || !leavesTheLadder(declared)) continue
        if (!/color: '\$/.test(declared)) offenders.push(`${name}.${state}`)
      }
    }
    expect(offenders).toEqual([])
  })

  /**
   * And that the pressed label is reachable on native, where inheritance does not exist.
   *
   * `PRESSED_LABEL` is what carries it there. A variant that inverts without an entry in it is
   * illegible on a phone and correct on a desktop, which is the worst shape available: half the
   * platforms report it as fine.
   */
  it('has a native pressed-label entry wherever the press inverts', () => {
    const pressedLabel = /const PRESSED_LABEL[\s\S]*?\n\}/.exec(source)?.[0] ?? ''
    const inverts = [...presses]
      .filter(([, declared]) => leavesTheLadder(declared))
      .map(([name]) => name)

    expect(inverts.length).toBeGreaterThan(0)
    expect(inverts.filter((name) => !new RegExp(`^\\s+${name}:`, 'm').test(pressedLabel))).toEqual(
      [],
    )
  })

  /**
   * And that native presses with the same table. `PRESSED` is what native applies while held, and a
   * variant restated there by hand can drift from its web press -- `simple` pressed at 0.7 on
   * native against 0.55 on the web, so a click on a hovered label showed nothing.
   */
  it('presses on native with its entry in the shared table, less only the label colour', () => {
    const pressed = /const PRESSED = \{[\s\S]*?\n\} as const/.exec(source)?.[0] ?? ''
    const restated = [...found.keys()].filter(
      (name) =>
        !new RegExp(
          `^\\s+${name}: (withoutColor\\(PRESS_STYLE\\.${name}\\)|PRESS_STYLE\\.${name}),$`,
          'm',
        ).test(pressed),
    )
    expect(restated).toEqual([])
  })
})

describe('a loading Button', () => {
  it('keeps its size: the content stays laid out, hidden, and the spinner is drawn over it', () => {
    // The icon and the label are both concealed rather than swapped out, so neither the width
    // nor the height changes when an export or a save starts and the layout around it holds still.
    expect(source).toMatch(/<Concealed when=\{loading\}>\{icon\}<\/Concealed>/)
    expect(source).toMatch(/<Concealed when=\{loading\}>\s*\{typeof children === 'string'/)
    expect(readFileSync(join(import.meta.dirname, '../src/Concealed.tsx'), 'utf8')).toMatch(
      /opacity=\{0\}/,
    )
    // Over the content and centred, not beside it.
    expect(source).toMatch(
      /position="absolute"[\s\S]{0,200}alignItems="center"[\s\S]{0,80}justifyContent="center"[\s\S]{0,80}<Spinner/,
    )
    expect(source).not.toMatch(/\{loading \? <Spinner[^}]*\/> : icon\}/)
  })
})

describe('a loading Button, to a screen reader', () => {
  it('keeps its name on the control, since Android does not read a transparent label', () => {
    expect(source).toMatch(
      /accessibilityLabel \?\? \(loading && typeof children === 'string' \? children : undefined\)/,
    )
    expect(source).toMatch(/accessibilityLabel: name/)
    expect(source).toMatch(/busy=\{loading\}/)
  })
})
