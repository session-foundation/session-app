import { memo, useState } from 'react'
import { YStack } from 'tamagui'

import type {
  WithDurationLabel,
  WithMediaKind,
  WithMediaPreview,
  WithMediaUri,
} from '@session/basic-types'

import {
  TILE_BADGE_INSET,
  TILE_HAIRLINE_WIDTH,
  TILE_SCRIM,
  tilePlaceholder,
  tileRadius,
} from './attachmentTileStyle'
import { Icon } from './Icon'
import { Image } from './Image'
import { logical } from './logicalEdges'
import { Text } from './Text'
import type { WithTestID } from './with'

export type AttachmentTileProps = WithMediaUri &
  WithMediaPreview &
  WithMediaKind &
  WithDurationLabel &
  WithTestID & {
    /** Always square. The album and the list both size it; it never measures anything itself. */
    side: number
    /**
     * The count of attachments the album is not drawing, already worded.
     *
     * A string rather than a number because the wording is `andMore` in the catalogue and this
     * package cannot reach it -- `@session/ui` imports no sibling but theme-tokens, test-ids and
     * basic-types.
     */
    overflowLabel?: string | undefined
  }

/**
 * Below this a play mark stops marking the picture and starts covering it.
 *
 * At the list's 40, the small mark is three quarters of the tile. Nothing replaces it there: the
 * row's format label already reads MP4, which is the same fact in the space it fits in.
 */
const PLAY_MARK_MIN_SIDE = 56

/** The play mark and the length, which are only true once the file can be played. */
function VideoAffordances({ side, duration }: { side: number } & WithDurationLabel) {
  const small = side < 90
  return (
    <>
      {side < PLAY_MARK_MIN_SIDE ? null : (
        <YStack
          position="absolute"
          top={0}
          bottom={0}
          left={0}
          right={0}
          alignItems="center"
          justifyContent="center"
          pointerEvents="none"
        >
          <YStack
            width={small ? 30 : 40}
            height={small ? 30 : 40}
            borderRadius="$full"
            alignItems="center"
            justifyContent="center"
            backgroundColor={TILE_SCRIM}
          >
            <Icon name="play" size={small ? 'sm' : 'md'} color="$textPrimary" />
          </YStack>
        </YStack>
      )}
      {duration === undefined ? null : (
        // At every size, not only the large tile: it fits on a 70 px quarter and it is the one
        // fact somebody wants before tapping.
        <YStack
          position="absolute"
          bottom={TILE_BADGE_INSET}
          paddingHorizontal="$2xs"
          paddingVertical="$3xs"
          borderRadius="$full"
          backgroundColor={TILE_SCRIM}
          pointerEvents="none"
          {...logical({ insetStart: TILE_BADGE_INSET })}
        >
          <Text size="$caption" color="$textPrimary">
            {duration}
          </Text>
        </YStack>
      )}
    </>
  )
}

/**
 * One attachment, drawn as a rounded square.
 *
 * The same component serves the album, the list's thumbnails, the quote preview and the viewer's
 * filmstrip, which is what the rounded square is for: one shape to build and one to learn, at two
 * radii and any side length.
 *
 * **Nothing is drawn on a tile whose bytes are not here.** No download control, no play glyph and
 * no duration -- the set's own control says what is happening, in the album's corner, and three
 * things promising three different futures on one picture is the state that rule exists to
 * prevent. A video gets its affordances when it can be played.
 *
 * `testID` addresses **the picture**, not the tile: whether an attachment arrived is a question
 * about the image, and a probe pointed at the tile finds the placeholder under it.
 */
export const AttachmentTile = memo(function AttachmentTile({
  side,
  uri,
  kind,
  preview,
  duration,
  overflowLabel,
  testID,
}: AttachmentTileProps) {
  const radius = tileRadius(side)
  /**
   * Which url's picture has arrived.
   *
   * From the image rather than from a transfer: asking for a url is what starts the fetch, and the
   * load is the only honest report that the bytes are on screen. Keyed on the url, so a new one
   * starts hidden over the placeholder instead of showing an empty frame until it loads.
   */
  const [loadedUri, setLoadedUri] = useState<string | null>(null)
  const drawable = uri !== undefined && uri !== null
  const here = drawable && loadedUri === uri
  const [failedPreview, setFailedPreview] = useState<string | null>(null)
  const placeholder = tilePlaceholder(preview, failedPreview)

  return (
    <YStack
      position="relative"
      width={side}
      height={side}
      borderRadius={radius}
      overflow="hidden"
      backgroundColor="$backgroundTertiary"
    >
      {/* Underneath, always: the picture lands on top of it rather than replacing it, so nothing
          reflows and there is no frame where the tile is empty.

          The glyph is what a tile says when it has nothing else to say, so a tile wearing the
          sender's placeholder draws none - a symbol over it would be saying "a picture" on top of
          something that already looks like one. Which is the rare case: no 1.x client sends a
          hash, so for every message that exists today this is the glyph. */}
      {placeholder !== null ? (
        <YStack position="absolute" top={0} bottom={0} left={0} right={0}>
          <Image
            uri={placeholder}
            width={side}
            height={side}
            borderRadius={radius}
            onError={() => {
              setFailedPreview(placeholder)
            }}
          />
        </YStack>
      ) : (
        <YStack
          position="absolute"
          top={0}
          bottom={0}
          left={0}
          right={0}
          alignItems="center"
          justifyContent="center"
        >
          <Icon
            name={kind === 'video' ? 'video' : 'image'}
            size={side >= 90 ? 'lg' : 'md'}
            color="$textSecondary"
          />
        </YStack>
      )}

      {!drawable ? null : (
        <YStack opacity={here ? 1 : 0}>
          <Image
            uri={uri}
            width={side}
            height={side}
            borderRadius={radius}
            onLoad={() => {
              setLoadedUri(uri)
            }}
            testID={testID}
          />
        </YStack>
      )}

      {here && kind === 'video' ? <VideoAffordances side={side} duration={duration} /> : null}

      {here || placeholder !== null ? null : (
        // Only round the flat surface, which needs an edge to be seen against the page; a tile
        // wearing the picture's own colour already has one. Its own layer, because on Android a
        // border dropped from the clipping view as the picture lands leaves the tile blank.
        <YStack
          position="absolute"
          top={0}
          bottom={0}
          left={0}
          right={0}
          borderRadius={radius}
          borderWidth={TILE_HAIRLINE_WIDTH}
          borderColor="$bordersColor"
          pointerEvents="none"
        />
      )}

      {overflowLabel === undefined ? null : (
        // Replaces whatever is under it rather than sitting beside it: this tile stands for the
        // rest of the set, so what it happens to contain is not the point.
        <YStack
          position="absolute"
          top={0}
          bottom={0}
          left={0}
          right={0}
          alignItems="center"
          justifyContent="center"
          backgroundColor={TILE_SCRIM}
        >
          <Text size="$title" weight="semibold" color="$textPrimary">
            {overflowLabel}
          </Text>
        </YStack>
      )}
    </YStack>
  )
})
