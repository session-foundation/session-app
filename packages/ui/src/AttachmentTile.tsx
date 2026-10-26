import { memo, useState } from 'react'
import { YStack } from 'tamagui'

import type { WithMediaThumbhash, WithMediaUri } from '@session/basic-types'

import {
  TILE_HAIRLINE_WIDTH,
  TILE_SCRIM,
  showsPicture,
  tilePlaceholder,
  tileRadius,
} from './attachmentTileStyle'
import { Icon } from './Icon'
import { Image } from './Image'
import { Text } from './Text'
import type { WithTestID } from './with'

export type AttachmentTileProps = WithMediaUri &
  WithMediaThumbhash &
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
 * One attachment, drawn as a rounded square.
 *
 * The same component serves the album, the list's thumbnails, the quote preview and the viewer's
 * filmstrip, which is what the rounded square is for: one shape to build and one to learn, at two
 * radii and any side length.
 *
 * **Nothing is drawn on a tile whose bytes are not here.** No download control: the set's own
 * control says what is happening, in the album's corner, and two things promising two futures on
 * one picture is the state that rule exists to prevent.
 *
 * `testID` addresses **the picture**, not the tile: whether an attachment arrived is a question
 * about the image, and a probe pointed at the tile finds the placeholder under it.
 *
 * **No failed face.** What a tile is handed is libsession's thumbnail, made only of a picture that
 * decoded, so one that does not load was evicted under it: the placeholder is the true state.
 */
export const AttachmentTile = memo(function AttachmentTile({
  side,
  uri,
  thumbhash,
  overflowLabel,
  testID,
}: AttachmentTileProps) {
  const radius = tileRadius(side)
  /**
   * Which url's picture has arrived: the load is the only honest report that the bytes are on
   * screen. Keyed on the url, so a new one starts hidden over the placeholder instead of showing an
   * empty frame until it loads.
   */
  const [loadedUri, setLoadedUri] = useState<string | null>(null)
  const drawable = uri !== undefined && uri !== null
  const here = showsPicture(uri, loadedUri)
  const [failedThumbhash, setFailedThumbhash] = useState<string | null>(null)
  const placeholder = tilePlaceholder(thumbhash, failedThumbhash)

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
              setFailedThumbhash(placeholder)
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
          <Icon name="image" size={side >= 90 ? 'lg' : 'md'} color="$textSecondary" />
        </YStack>
      )}

      {!drawable ? null : (
        <YStack opacity={here ? 1 : 0}>
          <Image
            uri={uri}
            width={side}
            height={side}
            borderRadius={radius}
            // Fresco's JPEG sample rounding undershoots the view by up to 4/3, which reads as soft.
            resizeMultiplier={4 / 3}
            onLoad={() => {
              setLoadedUri(uri)
            }}
            testID={testID}
          />
        </YStack>
      )}

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
