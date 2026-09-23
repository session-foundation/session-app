import { describe, expect, it } from 'vitest'

import { isInChosenFolder } from '#src/main/files'

/**
 * What the renderer is allowed to hand the operating system.
 *
 * `showItemInFolder` and `openPath` both act on a path the page supplied, and the page is not
 * trusted to have checked one - the same standard `open-external` holds itself to. The rule is
 * that a path has to sit in a folder somebody pointed at in a save dialog this run.
 */
describe('a path the page asks to reveal', () => {
  const chosen = new Set(['/home/someone/Documents'])

  it('is allowed inside a folder that was chosen', () => {
    expect(isInChosenFolder('/home/someone/Documents/itinerary.pdf', chosen)).toBe(true)
  })

  it('is allowed under the name a collision produced', () => {
    // The path that comes back is not the path that went out: a save that collides becomes
    // `name (2)`, so matching whole paths would refuse the file that was just written.
    expect(isInChosenFolder('/home/someone/Documents/itinerary (2).pdf', chosen)).toBe(true)
  })

  it('is refused anywhere else', () => {
    expect(isInChosenFolder('/etc/passwd', chosen)).toBe(false)
    expect(isInChosenFolder('/home/someone/.ssh/id_ed25519', chosen)).toBe(false)
  })

  it('is refused in a folder that merely looks like one that was chosen', () => {
    // A prefix test would pass these. The comparison is the whole directory, not its start.
    expect(isInChosenFolder('/home/someone/Documents-old/x.pdf', chosen)).toBe(false)
    expect(isInChosenFolder('/home/someone/Documents/nested/x.pdf', chosen)).toBe(false)
  })

  it('is refused before anybody has chosen anything', () => {
    expect(isInChosenFolder('/home/someone/Documents/itinerary.pdf', new Set())).toBe(false)
  })

  it('is refused when it is not a path at all', () => {
    for (const nonsense of ['', null, undefined, 42, {}]) {
      expect(isInChosenFolder(nonsense, chosen)).toBe(false)
    }
  })
})
