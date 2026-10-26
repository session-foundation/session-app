import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { DETAIL_PANE, LIST_PANE, SOLE_PANE } from '#src/shell/panes'

const shell = readFileSync(join(import.meta.dirname, '../../src/shell/AdaptiveShell.tsx'), 'utf8')

/**
 * Back is shown only where it is the way back: in one pane it is the only way out, including in a
 * window narrowed with a conversation open, which stays on the conversation; beside the list, the
 * list is.
 */
describe('which panes show a way back', () => {
  it('hides it beside the list and shows it in one pane', () => {
    expect(DETAIL_PANE.besideList).toBe(true)
    expect(SOLE_PANE.besideList).toBe(false)
    expect(LIST_PANE.besideList).toBe(false)
  })

  it('keeps the window controls clear on the corners each pane runs into', () => {
    expect(SOLE_PANE.corners).toBe('both')
    expect(LIST_PANE.corners).toBe('start')
    expect(DETAIL_PANE.corners).toBe('end')
  })

  it('is told by the shell which pane each screen is in', () => {
    // Read rather than rendered: the layout is chosen by a media query, and what matters here is
    // that each pane is wrapped, which the source says outright.
    expect(shell).toContain(
      '<PaneProvider value={twoPanes ? LIST_PANE : SOLE_PANE}>{list}</PaneProvider>',
    )
    expect(shell).toContain('<PaneProvider value={twoPanes ? DETAIL_PANE : SOLE_PANE}>')
  })
})

/**
 * The detail pane survives a change between one pane and two. On mobile it holds the router's
 * `Slot`, which forgets the open conversation if it remounts, so turning a tablet would close it.
 */
describe('the detail pane across layouts', () => {
  it('is one keyed element, hidden rather than left out', () => {
    expect(shell).toContain(
      "<YStack key=\"detail\" flex={1} display={showsDetail ? 'flex' : 'none'}>",
    )
    // A second return would be a second tree, and the detail would remount on crossing over.
    expect(shell.match(/^ {2}return \(/gm)?.length).toBe(1)
  })
})
