import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { getThemeTokens } from '@session/theme-tokens'
import { describe, expect, it } from 'vitest'

import { buildThemes, TAMAGUI_NAMES } from '#src/themes'
import {
  COLOR_SCALE,
  FONT_SIZE_SCALE,
  FONT_WEIGHT_SCALE,
  LETTER_SPACING_SCALE,
  LINE_HEIGHT_SCALE,
  RADIUS_SCALE,
  SIZE_SCALE,
  SPACE_SCALE,
  Z_INDEX_SCALE,
} from '#src/scales'

/**
 * Every `$token` in the repository names something that exists.
 *
 * This is the guard for the sharpest edge in the whole UI layer: tamagui resolves a token it
 * does not know to 0 and says nothing. `padding="$smal"` silently loses the padding;
 * `color="$textPrimry"` silently paints nothing. TypeScript does not help -
 * every one of those props is typed as a string, so a name with a typo in it compiles.
 *
 * A test rather than a lint rule because the list of valid names is computed, not written
 * down: it comes from the scales and from whatever @session/theme-tokens publishes, and a
 * rule would need that list duplicated somewhere to read it. The cost is that it fails on
 * push rather than while typing.
 */

const repoRoot = join(import.meta.dirname, '../../..')

/** Where a `$token` can legitimately appear. Config and this test are not among them. */
const SEARCH_ROOTS = [
  'packages/ui/src',
  'packages/screens/src',
  'apps/desktop/src/renderer',
  'apps/mobile/app',
  'apps/mobile/src',
]

const SKIP_FILES = ['config.ts', 'scales.ts', 'themes.ts', 'tokens.contract.test.ts']

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  const walk = (path: string): void => {
    for (const entry of readdirSync(path)) {
      const full = join(path, entry)
      if (statSync(full).isDirectory()) {
        if (entry !== 'node_modules') walk(full)
      } else if (/\.tsx?$/.test(entry) && !SKIP_FILES.includes(entry)) {
        found.push(full)
      }
    }
  }
  walk(dir)
  return found
}

/**
 * Any `'$name'` or `"$name"` string literal, wherever it appears.
 *
 * Deliberately not anchored to `prop=` or `prop:`. A token named inside an expression --
 * `color={outgoing ? '$a' : '$b'}` -- is still a token, and a conditional style is exactly where a
 * name deleted from the palette goes unnoticed. The symptom is a component rendering at zero, so
 * the match has to be the literal rather than the position it sits in.
 */
const TOKEN_USE = /['"]\$([\w.-]+)['"]/g

function known(): Set<string> {
  const names = new Set<string>()
  const add = (scale: object): void => {
    for (const key of Object.keys(scale)) names.add(key)
  }

  add(COLOR_SCALE)
  add(SPACE_SCALE)
  add(SIZE_SCALE)
  add(RADIUS_SCALE)
  add(Z_INDEX_SCALE)
  add(FONT_SIZE_SCALE)
  add(LINE_HEIGHT_SCALE)
  add(FONT_WEIGHT_SCALE)
  add(LETTER_SPACING_SCALE)

  // Theme values: every theme has the same keys, so any one of them is the list.
  add(getThemeTokens('classic-dark', 'green'))

  // Negative space is tamagui's own notation for the scale it already knows.
  for (const key of [...names]) names.add(`-${key}`)

  // Font families, which are named in the config rather than in a scale.
  names.add('body')
  names.add('heading')
  names.add('mono')

  // Tamagui's platform style keys, which select where a style applies rather than naming a value.
  for (const platform of ['web', 'native', 'ios', 'android']) names.add(`platform-${platform}`)

  return names
}

describe('tamagui tokens', () => {
  const valid = known()

  it('has every name that is used somewhere', () => {
    const unknown: string[] = []

    for (const root of SEARCH_ROOTS) {
      for (const file of sourceFiles(join(repoRoot, root))) {
        const source = readFileSync(file, 'utf8')
        for (const [, name] of source.matchAll(TOKEN_USE)) {
          if (name !== undefined && !valid.has(name)) {
            unknown.push(`${file.slice(repoRoot.length + 1)}: $${name}`)
          }
        }
      }
    }

    // Named in the failure, because "a token is missing" is not enough to go on when the
    // symptom would otherwise be a component that renders at zero.
    expect(unknown).toEqual([])
  })

  it('gives tamagui every name its own components ask for', () => {
    // The other half of the same problem, and the half our own source cannot show: a
    // built-in asks for $backgroundFocus, no theme defines it, and the component renders an
    // invisible surface. Found exactly that way - one warning at a time, on a device.
    const themes = buildThemes()
    const missing: string[] = []

    for (const [theme, values] of Object.entries(themes)) {
      for (const name of TAMAGUI_NAMES) {
        if (!(name in values)) missing.push(`${theme}: $${name}`)
      }
    }

    expect(missing).toEqual([])
  })

  it('knows what a missing token looks like', () => {
    // Guards the guard: a regex that stopped matching would make the test above pass for
    // every file, which is the failure mode a scraping test has.
    const sample = `<Text color="$textPrimary" padding="$nope" />`
    const names = [...sample.matchAll(TOKEN_USE)].map(([, name]) => name)
    expect(names).toEqual(['textPrimary', 'nope'])
    expect(names.filter((name) => name !== undefined && !valid.has(name))).toEqual(['nope'])
  })
})
