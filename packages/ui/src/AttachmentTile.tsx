import { useState } from 'react'
import { YStack } from 'tamagui'

import { TILE_BADGE_INSET, TILE_HAIRLINE_WIDTH, TILE_SCRIM, tileRadius } from './attachmentTile'
import { blurhashColor } from './blurhash'
import { Icon } from './Icon'
import { Image } from './Image'
import { logical } from './logicalEdges'
import { Text } from './Text'

export interface AttachmentTileProps {
  /** Always square. The album and the list both size it; it never measures anything itself. */
  side: number
  /**
   * Where the bytes are, once they are here.
   *
   * Absent means they are not, and the tile draws what is coming instead. `null` means this
   * platform has no resolver for them at all, which looks the same and is not the same thing --
   * a caller that can tell the difference says so in its own caption, not on the tile.
   */
  uri?: string | null
  /** What is coming, which is all `contentType` can honestly say before any byte arrives. */
  kind: 'image' | 'video'
  /**
   * The sender's BlurHash, where they sent one.
   *
   * Unchecked here and checked in `blurhashColor`: it is a remote peer's string, and nothing
   * between the wire and this prop looks inside it.
   */
  blurhash?: string
  /** mm:ss, drawn on a video that can be played. */
  duration?: string
  /**
   * The count of attachments the album is not drawing, already worded.
   *
   * A string rather than a number because the wording is `andMore` in the catalogue and this
   * package cannot reach it -- `@session/ui` imports no sibling but theme-tokens, test-ids and
   * basic-types.
   */
  overflowLabel?: string
  /**
   * Addresses **the picture**, not the tile.
   *
   * The element a test asks about is the one holding the bytes: whether an attachment arrived is a
   * question about the image, and a probe pointed at the tile finds the placeholder under it.
   */
  testID?: string
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
 */
export function AttachmentTile({
  side,
  uri,
  kind,
  blurhash,
  duration,
  overflowLabel,
  testID,
}: AttachmentTileProps) {
  const radius = tileRadius(side)
  /**
   * Whether this tile's own picture has arrived.
   *
   * From the image rather than from a transfer, because that is what a url is: asking for one is
   * what starts the fetch, and the load is the only honest report that the bytes are on screen.
   * Each tile therefore resolves on its own - the album fills in one attachment at a time, which
   * is the per-item signal, for no chrome at all.
   */
  const [loaded, setLoaded] = useState(false)
  const drawable = uri !== undefined && uri !== null
  const here = drawable && loaded
  /** The picture's own colour, where the sender sent one. Null is the ordinary case: see below. */
  const average = blurhash === undefined ? null : blurhashColor(blurhash)

  return (
    <YStack
      position="relative"
      width={side}
      height={side}
      borderRadius={radius}
      overflow="hidden"
      backgroundColor={average ?? '$backgroundTertiary'}
      // Only round the flat surface, which needs an edge to be seen against the page. A tile
      // wearing the picture's own colour already has one.
      {...(here || average !== null
        ? {}
        : { borderWidth: TILE_HAIRLINE_WIDTH, borderColor: '$bordersColor' })}
    >
      {/* Underneath, always: the picture lands on top of it rather than replacing it, so nothing
          reflows and there is no frame where the tile is empty.

          The glyph is what a tile says when it has nothing else to say, so a tile wearing the
          picture's own colour draws none - a symbol over it would be saying "a picture" on top of
          something that already looks like one. Which is the rare case: no 1.x client sends a
          hash, so for every message that exists today this is the glyph. */}
      {average !== null ? null : (
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
        <YStack opacity={loaded ? 1 : 0}>
          <Image
            uri={uri}
            width={side}
            height={side}
            borderRadius={radius}
            onLoad={() => {
              setLoaded(true)
            }}
            {...(testID === undefined ? {} : { testID })}
          />
        </YStack>
      )}

      {here && kind === 'video' ? (
        <VideoAffordances side={side} {...(duration === undefined ? {} : { duration })} />
      ) : null}

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
}

/**
 * Below this a play mark stops marking the picture and starts covering it.
 *
 * At the list's 40, the small mark is three quarters of the tile. Nothing replaces it there: the
 * row's format label already reads MP4, which is the same fact in the space it fits in.
 */
const PLAY_MARK_MIN_SIDE = 56

/** The play mark and the length, which are only true once the file can be played. */
function VideoAffordances({ side, duration }: { side: number; duration?: string }) {
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
