import { memo, type ReactNode } from 'react'
import { isWeb, XStack, YStack } from 'tamagui'

import type {
  WithDurationLabel,
  WithFetchesOnOpen,
  WithMediaPreview,
  WithMediaUri,
} from '@session/basic-types'
import type { ElementId } from '@session/test-ids'

import { ALBUM_SEAM, albumLayout, cellPlace, lastCell } from './albumLayout'
import { AttachmentTile } from './AttachmentTile'
import { FetchHint } from './FetchHint'
import { tileRadius } from './attachmentTileStyle'
import { logical } from './logicalEdges'
import { StateLayer } from './StateLayer'
import type { WithTestID } from './with'

type AlbumMedia = WithMediaUri & WithMediaPreview & WithFetchesOnOpen & WithTestID
export type AlbumImage = AlbumMedia & { kind: 'image' }
export type AlbumVideo = AlbumMedia & { kind: 'video' } & WithDurationLabel
export type AlbumItem = AlbumImage | AlbumVideo

export type AttachmentAlbumProps = WithTestID & {
  items: readonly AlbumItem[]
  /** The message's own width. Never a constant: an album is as wide as the bubble it sits in. */
  width: number
  /** Already worded, because `@session/ui` cannot reach the catalogue. */
  overflowLabel: (count: number) => string
  onOpen: (at: number) => void
  /**
   * The set's own badge, drawn in the album's corner.
   *
   * The corner rather than the middle of a tile: a badge on a tile reads as that tile's state, and
   * this one is about the whole message, including the attachments behind "+N".
   */
  control?: ReactNode | undefined
  /** Already worded; what the cloud that fetches the set is announced as. */
  fetchLabel: string
  fetchTestID: ElementId
}

/**
 * The cell arrives as `at` and `side` rather than as itself: `albumLayout` builds new cells on
 * every render, and `memo` would see each one as a change.
 */
const AlbumTile = memo(function AlbumTile({
  item,
  at,
  side,
  overflowLabel,
  onOpen,
}: {
  /** Absent only where the layout and the items disagree, which draws nothing. */
  item: AlbumItem | undefined
  at: number
  side: number
  /** Only on the tile that carries the overflow. */
  overflowLabel?: string | undefined
  onOpen: (at: number) => void
}) {
  if (item === undefined) return null
  // A tile that would fetch is the whole set's, so it dims with the album, and at rest on touch
  // under the album's cloud. One that is here opens its own picture, so it answers on its own.
  const fetches = item.fetchesOnOpen === true
  return (
    <YStack
      role="button"
      position="relative"
      $platform-web={{ cursor: 'pointer' }}
      onPress={() => {
        onOpen(at)
      }}
      {...(fetches ? {} : { group: 'tile' as const })}
    >
      <AttachmentTile
        side={side}
        kind={item.kind}
        uri={item.uri}
        preview={item.preview}
        duration={item.kind === 'video' ? item.duration : undefined}
        overflowLabel={overflowLabel}
        testID={item.testID}
      />
      <StateLayer
        group={fetches ? 'album' : 'tile'}
        tone="scrim"
        borderRadius={tileRadius(side)}
        atRest={fetches && !isWeb}
      />
    </YStack>
  )
})

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
  fetchLabel,
  fetchTestID,
  testID,
}: AttachmentAlbumProps) {
  const layout = albumLayout(items.length, width)
  const last = lastCell(layout)

  const overflowAt = layout.overflow > 0 ? last?.at : undefined
  const overflowText = overflowAt === undefined ? undefined : overflowLabel(layout.overflow)
  // One cloud for the message: a press on any tile fetches the whole set, so no tile is its own.
  const fetchAt = items.findIndex((item) => item.fetchesOnOpen === true)
  const fetchesOnOpen = fetchAt !== -1
  // Centred on the album, the three-up's cloud would sit off-centre on its big tile, near the
  // seam; there it sits over the tile that fetches instead.
  const threeUp =
    layout.lead !== null && layout.rows.length > 0 && layout.rows.every((row) => row.length === 1)
  const hintPlace = threeUp && fetchesOnOpen ? cellPlace(layout, fetchAt) : undefined
  const hint = fetchesOnOpen ? (
    <FetchHint
      side={hintPlace?.side ?? width}
      group="album"
      restsOnTouch
      onPress={() => {
        onOpen(fetchAt)
      }}
      label={fetchLabel}
      testID={fetchTestID}
    />
  ) : null

  const beside = (
    <YStack gap={ALBUM_SEAM}>
      {layout.rows.map((row, at) => (
        <XStack key={row[0]?.at ?? at} gap={ALBUM_SEAM}>
          {row.map((cell) => (
            <AlbumTile
              key={cell.at}
              item={items[cell.at]}
              at={cell.at}
              side={cell.side}
              overflowLabel={cell.at === overflowAt ? overflowText : undefined}
              onOpen={onOpen}
            />
          ))}
        </XStack>
      ))}
    </YStack>
  )

  return (
    // `relative`, so the control resolves against the album and not the page.
    <YStack position="relative" group="album" testID={testID}>
      {layout.lead === null ? (
        beside
      ) : (
        <XStack gap={ALBUM_SEAM}>
          <AlbumTile
            item={items[layout.lead.at]}
            at={layout.lead.at}
            side={layout.lead.side}
            overflowLabel={layout.lead.at === overflowAt ? overflowText : undefined}
            onOpen={onOpen}
          />
          {layout.rows.length === 0 ? null : beside}
        </XStack>
      )}

      {hintPlace === undefined ? (
        hint
      ) : (
        // A row, so the box sits over its tile in either reading direction. `box-none` down to the
        // cloud, so the tile under the rest of the box keeps its own press.
        <XStack position="absolute" top={0} bottom={0} left={0} right={0} pointerEvents="box-none">
          <YStack
            position="relative"
            width={hintPlace.side}
            height={hintPlace.side}
            marginTop={hintPlace.top}
            pointerEvents="box-none"
            {...logical({ marginStart: hintPlace.start })}
          >
            {hint}
          </YStack>
        </XStack>
      )}

      {control === undefined ? null : (
        // The album owns the corner; the control owns what it says. `flex-end` rather than an
        // inline inset, so it mirrors with the layout and nothing has to ask which way it reads.
        <YStack
          position="absolute"
          top={0}
          bottom={0}
          left={0}
          right={0}
          alignItems="flex-end"
          padding="$xs"
          pointerEvents="box-none"
        >
          {control}
        </YStack>
      )}
    </YStack>
  )
}
