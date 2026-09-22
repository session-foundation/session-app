import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Read rather than imported, the way `tokens.contract.test.ts` reads the theme files: importing
 * `Icon.tsx` would load a glyph, and a glyph loads react-native-svg, which wants a renderer this
 * suite has no business standing up.
 *
 * What is worth pinning here is the wiring, and none of it needs one. A name in the union with no
 * entry in the map draws nothing. And a glyph imported from the package barrel costs the mobile
 * bundle every one of lucide's ~1500 icons, because Metro does not tree-shake - a mistake with no
 * visible symptom at all, which is exactly the kind worth a test.
 */
/** The sources under test, which live beside src rather than beside this file. */
const dir = join(import.meta.dirname, '../src')
const component = readFileSync(join(dir, 'Icon.tsx'), 'utf8')
const types = readFileSync(join(dir, 'Icon.types.ts'), 'utf8')

/** The members of the `IconName` union, in declaration order. */
const names = [
  ...(/export type IconName =([^\n]*(?:\n[^\n]*)*?)\n\n/.exec(types)?.[1] ?? '').matchAll(
    /'([^']+)'/g,
  ),
].map((m) => m[1])

/** The `name: Glyph` pairs of the map in `Icon.tsx`. */
const mapped = [...component.matchAll(/^ {2}(\w+): (\w+),$/gm)].map((m) => m[1])

/** The names in the `MIRRORED_IN_RTL` set. */
const mirrored = [
  ...(/const MIRRORED_IN_RTL[^=]*= new Set\(\[([^\]]*)\]\)/.exec(component)?.[1] ?? '').matchAll(
    /'([^']+)'/g,
  ),
].map((m) => m[1])

/** Everything imported from the icon set, as written. */
const specifiers = [...component.matchAll(/from '(@tamagui\/lucide-icons-2[^']*)'/g)].map(
  (m) => m[1],
)

describe('Icon', () => {
  it('names at least one icon', () => {
    // Without this the two below would pass over an empty set and prove nothing.
    expect(names.length).toBeGreaterThan(0)
  })

  it('has a glyph for every name, and names every glyph', () => {
    expect([...mapped].sort()).toEqual([...names].sort())
  })

  it('imports each glyph by its own subpath, never from the barrel', () => {
    expect(specifiers.length).toBe(names.length)
    for (const specifier of specifiers)
      expect(specifier, 'a barrel import costs Metro every icon lucide ships').toMatch(
        /^@tamagui\/lucide-icons-2\/icons\/[A-Za-z0-9]+$/,
      )
  })

  it('mirrors only names it has a glyph for', () => {
    // A typo here is otherwise silent: the set is keyed by the union, so a name that is not in it
    // does not compile - but one that *is* in the union and was renamed later would simply stop
    // mirroring, with nothing to notice.
    expect(mirrored.length).toBeGreaterThan(0)
    for (const name of mirrored) expect(names).toContain(name)
  })

  it('never mirrors a glyph that has a mirrored twin of its own', () => {
    // The pairs are chosen between by the caller, from `isLayoutRtl()`. Flipping one of them here
    // would give a caller that picked correctly a glyph pointing back the way it came.
    for (const pair of ['chevronLeft', 'chevronRight', 'skipBack', 'skipForward'])
      expect(mirrored).not.toContain(pair)
  })
})
