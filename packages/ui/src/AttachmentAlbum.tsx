import type { ReactNode } from 'react'
import { XStack, YStack } from 'tamagui'

import { ALBUM_SEAM, albumLayout, lastCell, type AlbumCell } from './albumLayout'
import { AttachmentTile } from './AttachmentTile'
import { logical } from './logicalEdges'

export interface AlbumItem {
  /** Where the bytes are, once they are here. Null where this platform has no resolver. */
  uri?: string | null
  kind: 'image' | 'video'
  duration?: string
  testID?: string
}

export interface AttachmentAlbumProps {
  items: readonly AlbumItem[]
  /** The message's own width. Never a constant: an album is as wide as the bubble it sits in. */
  width: number
  /** Already worded, because `@session/ui` cannot reach the catalogue. */
  overflowLabel: (count: number) => string
  onOpen: (at: number) => void
  /** Drawn over the box the layout names, which is the lead tile or the whole album. */
  control?: ReactNode
  testID?: string
}

/**
 * Every picture on one message, as one object.
 *
 * The geometry is `albumLayout`'s, so this places and never measures. The set's own control is
 * handed in rather than built here: what it says is a fact about the message's transfers, which
 * this package knows nothing about, and where it sits is a fact about the shape, which the layout
 * already answered.
 */
export function AttachmentAlbum({
  items,
  width,
  overflowLabel,
  onOpen,
  control,
  testID,
}: AttachmentAlbumProps) {
  const layout = albumLayout(items.length, width)
  const last = lastCell(layout)

  function tile(cell: AlbumCell) {
    const item = items[cell.at]
    if (item === undefined) return null
    const carriesOverflow = layout.overflow > 0 && cell.at === last?.at
    return (
      <YStack
        key={cell.at}
        accessibilityRole="button"
        onPress={() => {
          onOpen(cell.at)
        }}
      >
        <AttachmentTile
          side={cell.side}
          kind={item.kind}
          {...(item.uri === undefined ? {} : { uri: item.uri })}
          {...(item.duration === undefined ? {} : { duration: item.duration })}
          {...(carriesOverflow ? { overflowLabel: overflowLabel(layout.overflow) } : {})}
          {...(item.testID === undefined ? {} : { testID: item.testID })}
        />
      </YStack>
    )
  }

  const beside = (
    <YStack gap={ALBUM_SEAM}>
      {layout.rows.map((row, at) => (
        // The row index is the key because a row is a position in the shape, not an attachment:
        // the cells inside it carry their own.
        <XStack key={at} gap={ALBUM_SEAM}>
          {row.map(tile)}
        </XStack>
      ))}
    </YStack>
  )

  return (
    // `relative`, so the control resolves against the album and not the page.
    <YStack position="relative" testID={testID}>
      {layout.lead === null ? (
        beside
      ) : (
        <XStack gap={ALBUM_SEAM}>
          {tile(layout.lead)}
          {layout.rows.length === 0 ? null : beside}
        </XStack>
      )}

      {control === undefined ? null : (
        <YStack
          position="absolute"
          top={0}
          width={layout.control.width}
          height={layout.control.height}
          alignItems="center"
          justifyContent="center"
          pointerEvents="box-none"
          {...logical({ insetStart: 0 })}
        >
          {control}
        </YStack>
      )}
    </YStack>
  )
}
