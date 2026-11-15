import { ELEMENT } from '@session/test-ids'
import { YStack } from 'tamagui'

import { ContextMenuLayer } from '../../ContextMenu'
import type { ContextMenuEntry } from '../../contextMenuEntries'
import { isLayoutRtl } from '../../layoutDirection'
import { defineStory } from '../story'
import { LONG, noop } from './shared'

const ITEM = ELEMENT.contextMenu.item
const TEST_IDS = ELEMENT.contextMenu

/** Wide enough for a submenu beside its parent; narrower and it opens in place. */
const CELL_WIDTH = 600
const CELL_HEIGHT = 340
/** Where the pointer was, from the cell's leading corner. */
const POINTER = 12

export function action(
  id: string,
  label: string,
  extra: Partial<ContextMenuEntry> = {},
): ContextMenuEntry {
  return {
    id,
    kind: 'action',
    label,
    testID: ITEM(id),
    onSelect: noop,
    ...extra,
  } as ContextMenuEntry
}

const separator = (id: string): ContextMenuEntry => ({ id, kind: 'separator' })

/** Every kind of entry: icons, a separator, a disabled row, a destructive one, a submenu. */
export const KINDS: readonly ContextMenuEntry[] = [
  action('reply', 'Reply', { icon: 'reply' }),
  action('copy', 'Copy', { icon: 'copy' }),
  action('save', 'Save', { icon: 'download', disabled: true }),
  {
    id: 'more',
    kind: 'submenu',
    label: 'Notifications',
    icon: 'bellOff',
    testID: ITEM('more'),
    entries: [
      action('all', 'All Messages', { icon: 'messageSquare' }),
      action('mentions', 'Mentions Only', { icon: 'info', disabled: true }),
      separator('mute-separator'),
      action('mute', 'Mute', { icon: 'volumeX' }),
    ],
  },
  separator('danger'),
  action('delete', 'Delete', { icon: 'trash', destructive: true }),
]

export const LONG_LABELS: readonly ContextMenuEntry[] = [
  action('long', LONG, { icon: 'copy' }),
  action('short', 'Copy', { icon: 'copy' }),
  {
    id: 'more',
    kind: 'submenu',
    label: LONG,
    icon: 'settings',
    testID: ITEM('more'),
    entries: [action('inner', LONG, { icon: 'info' })],
  },
]

const ARABIC: readonly ContextMenuEntry[] = [
  action('reply', 'رد', { icon: 'reply' }),
  action('copy', 'نسخ', { icon: 'copy' }),
  action('save', 'حفظ', { icon: 'download', disabled: true }),
  separator('danger'),
  action('delete', 'حذف', { icon: 'trash', destructive: true }),
]

interface MenuCase {
  entries: readonly ContextMenuEntry[]
  initialPath?: readonly string[]
  inPlace?: boolean
  /** Opened at the far corner, so it has to grow back toward the pointer on both axes. */
  farCorner?: boolean
}

function MenuCell({ entries, initialPath = [], inPlace = false, farCorner = false }: MenuCase) {
  const rtl = isLayoutRtl()
  const fromLeading = farCorner ? CELL_WIDTH - POINTER : POINTER
  return (
    <YStack position="relative" width={CELL_WIDTH} height={CELL_HEIGHT}>
      <ContextMenuLayer
        anchor={{
          kind: 'point',
          x: rtl ? CELL_WIDTH - fromLeading : fromLeading,
          y: farCorner ? CELL_HEIGHT - POINTER : POINTER,
        }}
        bounds={{ width: CELL_WIDTH, height: CELL_HEIGHT }}
        entries={entries}
        initialPath={initialPath}
        inPlace={inPlace}
        takesFocus={false}
        onDismiss={noop}
        onSelect={noop}
        accessibilityLabel="Message"
        backLabel="Back"
        testIDs={TEST_IDS}
      />
    </YStack>
  )
}

function menuStory(story: string, variants: Record<string, MenuCase>) {
  return defineStory<MenuCase>({
    component: 'contextMenu',
    story,
    width: CELL_WIDTH,
    forced: ['hover', 'focus'],
    sensitive: { rtl: true },
    variants,
    render: (props) => <MenuCell {...props} />,
  })
}

// Two stories, because a nightly page draws every row in four themes and three states, and all six
// rows together outgrow the capture window.
export const contextMenu = menuStory('kinds', {
  kinds: { entries: KINDS },
  submenu: { entries: KINDS, initialPath: ['more'] },
  inPlace: { entries: KINDS, initialPath: ['more'], inPlace: true },
  farCorner: { entries: KINDS, farCorner: true },
})

export const contextMenuLabels = menuStory('labels', {
  long: { entries: LONG_LABELS, initialPath: ['more'] },
  arabic: { entries: ARABIC },
})
