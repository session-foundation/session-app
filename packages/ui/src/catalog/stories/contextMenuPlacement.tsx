import { ELEMENT } from '@session/test-ids'
import { YStack } from 'tamagui'

import { ContextMenuLayer } from '../../ContextMenu'
import type { ContextMenuEntry } from '../../contextMenuEntries'
import type { MenuAnchor } from '../../contextMenuPlacement'
import { isLayoutRtl } from '../../layoutDirection'
import { logical } from '../../logicalEdges'
import { defineStory } from '../story'
import { action, KINDS, LONG_LABELS } from './contextMenu'
import { noop } from './shared'

/** The widest window drawn, which is the cell. */
const CELL_WIDTH = 600
const WINDOW_HEIGHT = 360
/** Under twice the menu's widest, so a submenu opens in place of its parent. */
const NARROW_FOR_SUBMENUS = 420
/** Under the menu's narrowest plus its margins on either side of a mid-window pointer. */
const NARROW_FOR_MENU = 240

/** The pointer's crosshair: long enough to read past the menu's corner. */
const CROSSHAIR = 14
const CROSSHAIR_LINE = 2

/** Enough rows that the menu is taller than a short window. */
const MANY: readonly ContextMenuEntry[] = Array.from({ length: 12 }, (_, at) =>
  action(`row-${String(at)}`, `Row ${String(at + 1)}`, { icon: 'copy' }),
)

/** A submenu holding an entry with its opener's id, which ids unique among siblings allow. */
const REPEATED_ID: readonly ContextMenuEntry[] = KINDS.map((entry) =>
  entry.kind === 'submenu'
    ? {
        ...entry,
        entries: [action(entry.id, 'Repeats Its Opener', { icon: 'copy' }), ...entry.entries],
      }
    : entry,
)

/** A rectangle measured from the window's leading edge, so a right-to-left page mirrors it. */
interface LeadingRect {
  start: number
  y: number
  width: number
  height: number
}

interface PlacementCase {
  window?: { width: number; height: number }
  /** A right-click here, from the window's leading edge. */
  pointer?: { start: number; y: number }
  /** Opened against this element from the keyboard. */
  element?: LeadingRect
  entries?: readonly ContextMenuEntry[]
  initialPath?: readonly string[]
}

function physicalX(start: number, width: number, windowWidth: number, rtl: boolean): number {
  return rtl ? windowWidth - start - width : start
}

function Crosshair({ start, y }: { start: number; y: number }) {
  const half = CROSSHAIR / 2
  const line = CROSSHAIR_LINE / 2
  return (
    <>
      <YStack
        position="absolute"
        top={y - line}
        width={CROSSHAIR}
        height={CROSSHAIR_LINE}
        backgroundColor="$dangerColor"
        {...logical({ insetStart: start - half })}
      />
      <YStack
        position="absolute"
        top={y - half}
        width={CROSSHAIR_LINE}
        height={CROSSHAIR}
        backgroundColor="$dangerColor"
        {...logical({ insetStart: start - line })}
      />
    </>
  )
}

/**
 * One window with the menu placed in it as the app places it, and what it was opened on drawn
 * over it: the crosshair of a right-click, or the outline of the element a keyboard opened it from.
 */
function PlacementCell({
  window = { width: CELL_WIDTH, height: WINDOW_HEIGHT },
  pointer,
  element,
  entries = KINDS,
  initialPath = [],
}: PlacementCase) {
  const rtl = isLayoutRtl()
  const anchor: MenuAnchor =
    element === undefined
      ? {
          kind: 'point',
          x: physicalX(pointer?.start ?? 0, 0, window.width, rtl),
          y: pointer?.y ?? 0,
        }
      : {
          kind: 'element',
          rect: {
            x: physicalX(element.start, element.width, window.width, rtl),
            y: element.y,
            width: element.width,
            height: element.height,
          },
        }
  return (
    <YStack
      position="relative"
      width={window.width}
      height={window.height}
      borderWidth={1}
      borderColor="$bordersColor"
      backgroundColor="$backgroundPrimary"
    >
      {element === undefined ? null : (
        <YStack
          position="absolute"
          top={element.y}
          width={element.width}
          height={element.height}
          borderRadius="$lg"
          borderWidth={2}
          borderStyle="dashed"
          borderColor="$dangerColor"
          backgroundColor="$messageBubbleIncomingBg"
          {...logical({ insetStart: element.start })}
        />
      )}
      <ContextMenuLayer
        anchor={anchor}
        bounds={window}
        entries={entries}
        initialPath={initialPath}
        takesFocus={false}
        onDismiss={noop}
        onSelect={noop}
        accessibilityLabel="Message"
        backLabel="Back"
        testIDs={ELEMENT.contextMenu}
      />
      {pointer === undefined ? null : <Crosshair start={pointer.start} y={pointer.y} />}
    </YStack>
  )
}

/** A bubble's size, for the keyboard cases. */
const BUBBLE = { width: 260, height: 60 } as const

function placementStory(story: string, variants: Record<string, PlacementCase>) {
  return defineStory<PlacementCase>({
    component: 'contextMenu',
    story,
    width: CELL_WIDTH,
    sensitive: { rtl: true },
    variants,
    render: (props) => <PlacementCell {...props} />,
  })
}

// Three stories, because a nightly page draws every row in four themes, and all of these rows
// together outgrow the capture window.
export const contextMenuPlacement = placementStory('placement', {
  roomy: { pointer: { start: 120, y: 40 } },
  trailingEdge: { pointer: { start: 560, y: 40 } },
  bottomEdge: { pointer: { start: 120, y: 330 } },
  corner: { pointer: { start: 560, y: 330 } },
  neitherAcross: {
    window: { width: NARROW_FOR_MENU, height: WINDOW_HEIGHT },
    pointer: { start: 120, y: 40 },
  },
  neitherDown: { window: { width: CELL_WIDTH, height: 300 }, pointer: { start: 120, y: 150 } },
  tallerThanWindow: {
    window: { width: CELL_WIDTH, height: 200 },
    pointer: { start: 120, y: 60 },
    entries: MANY,
  },
})

export const contextMenuSubmenuPlacement = placementStory('submenuPlacement', {
  submenu: { pointer: { start: 60, y: 40 }, initialPath: ['more'] },
  submenuFlips: { pointer: { start: 380, y: 40 }, initialPath: ['more'] },
  submenuAtBottom: { pointer: { start: 60, y: 120 }, initialPath: ['more'] },
  submenuInPlace: {
    window: { width: NARROW_FOR_SUBMENUS, height: WINDOW_HEIGHT },
    pointer: { start: 60, y: 40 },
    initialPath: ['more'],
  },
  // Wide rows, so neither side of the parent holds the submenu: it lies over the parent instead.
  submenuNoRoom: { pointer: { start: 160, y: 40 }, entries: LONG_LABELS, initialPath: ['more'] },
  submenuRepeatsId: {
    pointer: { start: 60, y: 120 },
    entries: REPEATED_ID,
    initialPath: ['more'],
  },
})

export const contextMenuKeyboardPlacement = placementStory('keyboardPlacement', {
  keyboardBelow: { element: { start: 40, y: 40, ...BUBBLE } },
  keyboardTrailingBubble: { element: { start: 300, y: 40, ...BUBBLE } },
  keyboardAbove: { element: { start: 40, y: 270, ...BUBBLE } },
  keyboardOver: { element: { start: 40, y: 30, width: BUBBLE.width, height: 300 } },
})
