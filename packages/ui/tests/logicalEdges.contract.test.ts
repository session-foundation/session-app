import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * An edge that follows the reading direction is named for the direction, not the side.
 *
 * `marginStart`, `paddingEnd`, `start`, `end` — not `marginLeft`, `paddingRight`, `left`, `right`.
 * The two are the same thing in English and opposite things in Arabic, and the app ships Arabic,
 * Baluchi, Persian, Hebrew, Pashto and Urdu. A physical edge is not a bug anybody sees until a
 * layout mirrors, at which point every one of them is wrong at once, so the convention is the
 * thing worth holding rather than the individual fix.
 *
 * Caught here rather than by review because it is a habit: the physical name is the one that comes
 * to mind, it reads correctly in the language the code is written in, and nothing about it looks
 * wrong on screen.
 */
describe('a directional edge', () => {
  const roots = [
    join(import.meta.dirname, '../src'),
    join(import.meta.dirname, '../../screens/src'),
  ]

  /**
   * Where a physical side is the right answer, and why.
   *
   * A device inset is physical: the notch is on the side it is on whatever the reading direction,
   * so `SafeArea` and `Screen` must not follow the text. A `left`/`right` pair used together is a
   * symmetric stretch rather than a side.
   */
  const PHYSICAL_ON_PURPOSE = [
    'SafeArea.native.tsx',
    'Screen.native.tsx',
    'PhoneChrome.tsx',
    // The path flow's requests, placed in the drawing's own coordinates, which do not mirror.
    'PathSpritesHost.tsx',
    // Icon names, not edges: a chevron that points left is a glyph, and which glyph a control
    // should use is the caller's decision rather than this file's.
    'Icon.types.ts',
    'Icon.tsx',
  ]

  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return sources(path)
      return /\.tsx?$/.test(entry.name) ? [path] : []
    })
  }

  /**
   * Comments are stripped first, so prose about left and right is not read as code.
   *
   * The scan is by shape rather than by a list of prop names -- anything with `Left` or `Right`
   * in it, used as a prop or a style key. Naming the props known at the time is how an unmirrored
   * `borderRightWidth` came to sit between the two desktop panes while this test passed.
   */
  function code(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
  }

  /**
   * A side named without its mirror.
   *
   * **A matched pair is not an offence**, which is the distinction a plain search cannot make: a
   * dialog rounding both bottom corners and a box inset equally from both sides are symmetric
   * geometry, the same in every language. One without the other is a side, and a side is what
   * mirrors wrong. Counted rather than paired up element by element, which is as far as reading
   * the source rather than the tree can get.
   */
  function unpairedSides(source: string): string[] {
    const used = new Map<string, number>()
    // The bare pair only in its JSX form: `const left = …` is a variable, and a `left` read off
    // `getBoundingClientRect` is the browser's own physical rect.
    for (const [match] of source.matchAll(
      /\b[A-Za-z]*(?:Left|Right)[A-Za-z]*\s*[=:]|\b(?:left|right)=\{/g,
    )) {
      const name = match.replace(/\s*(?:[=:]|=\{)$/, '').trim()
      used.set(name, (used.get(name) ?? 0) + 1)
    }
    return [...used]
      .filter(([name, count]) => {
        const mirror = /Left/.test(name)
          ? name.replace('Left', 'Right')
          : /Right/.test(name)
            ? name.replace('Right', 'Left')
            : name === 'left'
              ? 'right'
              : 'left'
        return (used.get(mirror) ?? 0) !== count
      })
      .map(([name]) => name)
  }

  it('is named for the direction rather than the side', () => {
    const offenders = roots
      .flatMap(sources)
      .map((path) => ({
        name: path.slice(path.lastIndexOf('/') + 1),
        source: code(readFileSync(path, 'utf8')),
      }))
      .filter(({ name }) => !PHYSICAL_ON_PURPOSE.includes(name))
      .flatMap(({ name, source }) => unpairedSides(source).map((prop) => `${name}: ${prop}`))

    expect(offenders).toEqual([])
  })
})

/**
 * `logical()` values are raw style, where tamagui resolves nothing, so a token is silently dropped.
 * The lengths are typed against it; a colour is a string either way, so this greps for it.
 */
describe('logical()', () => {
  const roots = [
    join(import.meta.dirname, '../src'),
    join(import.meta.dirname, '../../screens/src'),
  ]

  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return sources(path)
      return /\.tsx?$/.test(entry.name) ? [path] : []
    })
  }

  it('is never given a token', () => {
    const offenders = roots
      .flatMap(sources)
      .filter((path) => /logical\(\{[^}]*['"]\$/.test(readFileSync(path, 'utf8')))
    expect(offenders).toEqual([])
  })
})
