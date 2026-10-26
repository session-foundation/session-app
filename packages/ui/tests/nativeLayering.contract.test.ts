import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Arrangements that only fail on a device, held by reading the source.
 *
 * Each of these draws correctly in a browser and in every unit test the package has, which is why
 * a grep is the check: `packages/ui` has no native renderer to test them in, and the failure on a
 * phone is a picture that never shows, a control under the status bar, or a list that will not
 * scroll. The fast e2e tier is Electron, where none of them reproduce.
 */
function source(file: string): string {
  return readFileSync(join(import.meta.dirname, '../src', file), 'utf8')
}

/** The props of the first JSX element opening at `marker` after `from`, up to its closing `>`. */
function openingTag(text: string, marker: string, from = 0): string {
  const start = text.indexOf(marker, from)
  expect(start).toBeGreaterThanOrEqual(0)
  return text.slice(start, text.indexOf('>\n', start))
}

describe('an attachment tile', () => {
  const tile = source('AttachmentTile.tsx')

  it('keeps its clipping view the same as the picture lands', () => {
    // On Android a border dropped from an `overflow: hidden` view as its image loads leaves the
    // tile blank, so nothing on the clipping view may depend on whether the picture has arrived.
    const root = openingTag(tile, '<YStack\n      position="relative"')
    expect(root).toContain('overflow="hidden"')
    expect(root).not.toMatch(/\bhere\b|borderWidth/)
  })

  it('draws its hairline as a layer of its own', () => {
    expect(tile).toMatch(/borderWidth=\{TILE_HAIRLINE_WIDTH\}[\s\S]*?pointerEvents="none"/)
  })
})

describe('the media viewer', () => {
  const viewer = source('MediaViewer.tsx')

  it('keeps its chrome inside the safe area, since a modal is drawn edge to edge on Android', () => {
    expect(viewer).toMatch(/<SafeArea>[\s\S]*icon="x"/)
  })

  it('lays the chevrons over the picture\u2019s own box, so they centre on the picture', () => {
    const box = viewer.lastIndexOf('<YStack', viewer.indexOf('onLayout='))
    // Its closing tag is the first one back at its own indentation.
    const indent = viewer.slice(viewer.lastIndexOf('\n', box) + 1, box)
    const boxEnd = viewer.indexOf(`\n${indent}</YStack>`, box)
    const chevrons = viewer.indexOf('testID={previousTestID}')
    const header = viewer.indexOf('testID={exportTestID}')
    expect(box).toBeGreaterThan(header)
    expect(chevrons).toBeGreaterThan(box)
    expect(chevrons).toBeLessThan(boxEnd)
  })

  it('offers no control that does nothing', () => {
    expect(viewer).not.toContain('ellipsis')
  })

  it('gives both chevrons a backdrop of their own, since they sit on the picture', () => {
    expect(viewer.match(/overMedia\n/g)?.length).toBe(2)
  })

  it('grows each control to a thumb’s target on touch', () => {
    expect(viewer).toContain("CONTROL_SLOP = (SIZE_SCALE['3xl'] - SIZE_SCALE.xl) / 2")
    // A slop stops at the parent's edge, so close and export are only as tall as the header.
    expect(viewer).toMatch(/HEADER_HEIGHT = isWeb \? [^:\n]+ : SIZE_SCALE\['3xl'\]\n/)
    expect(viewer).toContain('<XStack height={HEADER_HEIGHT}')
    expect(viewer).toMatch(/isWeb \? \{\} : \{ hitSlop: CONTROL_SLOP \}/)
  })
})

describe('a sheet', () => {
  const sheet = source('Sheet.tsx')

  it('closes from its scrim, and claims no press on anything around its body', () => {
    // A press handler on an ancestor of the scroller holds every touch that starts in the sheet,
    // and a slow drag then never becomes a scroll. So the scrim is what closes, as a sibling of
    // the surface, and neither the frame that places the surface nor the surface itself presses.
    const scrim = /<YStack\s+fullscreen[^>]*onPress=\{onClose\}[^>]*\/>/.exec(sheet)
    expect(scrim).not.toBeNull()
    const scrimEnd = (scrim?.index ?? 0) + (scrim?.[0].length ?? 0)
    const surfaceTagEnd = sheet.indexOf('>\n', sheet.indexOf('testID={testID}'))
    expect(surfaceTagEnd).toBeGreaterThan(scrimEnd)
    expect(sheet.slice(scrimEnd, surfaceTagEnd)).not.toContain('onPress')
    expect(sheet).not.toContain('stopPropagation')
    // The frame that places the surface covers the scrim, so it must let touches through to it.
    expect(openingTag(sheet, '<YStack', scrimEnd)).toContain('pointerEvents="box-none"')
  })
})

describe('a native screen', () => {
  const screen = source('Screen.native.tsx')

  it('wraps its content in no touchable, so a list inside can start a scroll', () => {
    expect(screen).not.toMatch(/<(Touchable\w*|Pressable)\b/)
    expect(screen).toContain('backgroundDismissResponder')
  })

  it('keeps the keyboard-avoiding view directly in the inset frame', () => {
    // It measures its offset from its parent: under a wrapper of any kind it misses the top
    // inset, and lifts the composer short of the keyboard by exactly that much.
    const frame = openingTag(screen, '<YStack', screen.indexOf('return ('))
    expect(frame).toContain('paddingTop=')
    const avoiding = screen.indexOf('<KeyboardAvoidingView')
    expect(avoiding).toBeGreaterThanOrEqual(0)
    const between = screen
      .slice(screen.indexOf(frame) + frame.length, avoiding)
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    expect(between).not.toMatch(/<\w+/)
  })
})
