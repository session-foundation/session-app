import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * A view holding an absolutely positioned child has to say it is `relative`.
 *
 * On native it does not: every react-native view is a containing block, so an absolute child is
 * placed against its parent and that is the end of it. On the web a stack is `static` unless it
 * says otherwise, and an absolute child then resolves its offsets against the **page** -- so the
 * same component is correct on three devices and wrong in the desktop app, which is the worst
 * shape a bug can have because every device pass agrees it is fine.
 *
 * The tab indicator is the worked example: unless its bar says `relative`, its `bottom: 0` draws a
 * green line across the foot of the window. A child with no `top` of its own escapes just as far
 * and still looks right, falling back to its static position, which is why this is asserted rather
 * than eyeballed.
 *
 * **Coarse on purpose.** Whether a parent is a containing block is a fact about the rendered tree
 * that no amount of reading source settles. What a grep can say is that a file using
 * `position="absolute"` had better mention `relative` somewhere. The real measurement is the sweep
 * over a running app: any absolutely positioned element whose `offsetParent` is `document.body`
 * has escaped.
 */
describe('an absolutely positioned child', () => {
  const roots = [
    join(import.meta.dirname, '../src'),
    join(import.meta.dirname, '../../screens/src'),
  ]

  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return sources(path)
      // Native files are exempt: there is no such thing as a static view there.
      return /\.tsx$/.test(entry.name) && !entry.name.includes('.native.') ? [path] : []
    })
  }

  /**
   * Files whose absolute child is deliberately placed against an ancestor declared elsewhere, and
   * which were **measured clean** on a running desktop app -- nothing in them resolves against the
   * page. A dialog's close button belongs to the surface the dialog itself puts up, the
   * scanner's frame to the camera pane, a tooltip's arrow to its bubble, which is itself
   * absolute, a staged tray end's fade to the tray's rail, and a landing's ring to the message
   * frame it is drawn round; naming a nearer parent here would
   * move them.
   *
   * Adding a file to this list means having run that measurement. It is not a place to put
   * something that has not been looked at.
   */
  const CONTAINED_ELSEWHERE = [
    'LandingHighlight.tsx',
    'LanguagePicker.tsx',
    'Modal.tsx',
    // The path flow's requests, laid over the flow's own card, which is `relative`.
    'PathSpritesHost.tsx',
    'ScanQrPane.tsx',
    'TooltipArrow.tsx',
    'TrayEdgeFade.tsx',
  ]

  it('sits in a file that positions something', () => {
    const offenders = roots
      .flatMap(sources)
      .map((path) => ({
        name: path.slice(path.lastIndexOf('/') + 1),
        source: readFileSync(path, 'utf8'),
      }))
      .filter(({ name }) => !CONTAINED_ELSEWHERE.includes(name))
      .filter(
        ({ source }) => /position="absolute"/.test(source) && !/position="relative"/.test(source),
      )
      .map(({ name }) => name)

    expect(offenders).toEqual([])
  })
})
