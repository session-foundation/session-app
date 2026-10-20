import { isWeb, XStack, YStack } from 'tamagui'

import { SPACING } from '@session/theme-tokens'

import type {
  WithCaption,
  WithContentType,
  WithFetchesOnOpen,
  WithFilename,
  WithMediaKind,
  WithMediaPreview,
  WithMediaUri,
} from '@session/basic-types'
import type { ElementId } from '@session/test-ids'

import { AttachmentTile } from './AttachmentTile'
import { fileFormat, fileGlyph, nameDirection, splitFilename } from './attachmentFile'
import {
  FILE_GLYPH_SIDE,
  FILE_LEAD_WIDTH,
  FILE_ROW_CONTROL,
  FILE_ROW_GAP,
  fileLeadHeight,
  fileRowControl,
  fileRowTone,
  type FileRowState,
  type FileRowTone,
} from './fileRowState'
import { FetchHint } from './FetchHint'
import { Icon } from './Icon'
import { ProgressRing } from './ProgressRing'
import { StateLayer } from './StateLayer'
import { Text } from './Text'
import { useFontScale } from './useFontScale'
import { tileRadius } from './attachmentTileStyle'

export interface FileRowTestIDs {
  row?: ElementId | undefined
  name?: ElementId | undefined
  caption?: ElementId | undefined
  action?: ElementId | undefined
  /** Addresses the picture inside the thumbnail, so a test can ask whether it arrived. */
  thumbnail?: ElementId | undefined
}

/** What the lead square shows when the row is for something with a picture behind it. */
export type FileRowThumbnail = WithMediaUri & WithMediaPreview & WithMediaKind & WithFetchesOnOpen

export type FileRowProps = WithFilename &
  WithContentType &
  WithCaption & {
    /**
     * The picture this row stands for, where it has one.
     *
     * The same tile the album draws, at the smaller radius step: a list of pictures and a list of
     * documents are the same list, and the leading square is the one thing that differs.
     */
    thumbnail?: FileRowThumbnail | undefined
    /** Opens what the lead square shows. Absent where there is nothing to open. A press on the
     * rest of the row is `onAction`'s. */
    onOpen?: (() => void) | undefined
    state: FileRowState
    /** How far along, 0 to 1. Absent until the server has said how big the file is. */
    progress?: number | undefined
    /** Already worded, for what a screen reader announces the trailing control as. */
    actionLabel?: string | undefined
    onAction?: (() => void) | undefined
    testIDs?: FileRowTestIDs | undefined
  }

/** An icon has no `tone`, so it takes the colour the Text tone of the same name draws in. */
const TONE_COLOR = {
  primary: '$textPrimary',
  secondary: '$textSecondary',
  danger: '$dangerColor',
} as const satisfies Record<FileRowTone, string>

/**
 * The caption is the app's copy, so its words order by their own script rather than by the
 * name's direction it sits under. Native text already takes its paragraph direction that way.
 */
const CAPTION_BIDI = isWeb ? ({ unicodeBidi: 'plaintext' } as const) : undefined

/**
 * Drawn inside the touch target rather than filling it, so it reads as a gauge and not a button.
 */
const RING_SIDE = 28
const RING_THICKNESS = 3

/**
 * The one control, always in the same place and always the same size.
 *
 * What it offers is the row's state and nothing else has to say so: not here yet means Download,
 * here means Export. No verb is ever a word inside the caption line, and a failed row's retry is
 * the arrow alone - "Tap to retry" under a visible button is instructions for the button.
 */
function Trailing({
  state,
  progress,
  actionLabel,
  onAction,
  testID,
}: {
  state: FileRowState
  progress?: number | undefined
  actionLabel?: string | undefined
  onAction?: (() => void) | undefined
  testID?: ElementId | undefined
}) {
  const control = fileRowControl(state)

  // The square is held whatever the state, so the name's width does not change when a transfer
  // ends and the controls stay in one column down a list of rows.
  const square = {
    width: FILE_ROW_CONTROL,
    height: FILE_ROW_CONTROL,
    alignItems: 'center',
    justifyContent: 'center',
  } as const

  if (control === null) return <YStack {...square} />

  if (control === 'progress') {
    // Not a button: the bridge has no cancel, so a ring somebody could press would be a control
    // that does nothing. It reports, the way the album's pill does, and the caption has the counts.
    // TODO: make this a cancel once libsession and the bridge can stop a transfer.
    return (
      <YStack {...square}>
        <ProgressRing progress={progress ?? 0} size={RING_SIDE} thickness={RING_THICKNESS} />
      </YStack>
    )
  }

  return (
    <YStack
      {...square}
      role="button"
      position="relative"
      group="control"
      $platform-web={{ cursor: 'pointer' }}
      {...(actionLabel === undefined ? {} : { 'aria-label': actionLabel })}
      testID={testID}
      onPress={(event) => {
        // The row answers a press with the same action; this one is already it.
        event.stopPropagation()
        onAction?.()
      }}
    >
      <StateLayer group="control" tone="ink" borderRadius="$full" />
      <Icon name={control} size="sm" color={TONE_COLOR[fileRowTone(state).control]} />
    </YStack>
  )
}

/**
 * One file on one message.
 *
 * The shape a message falls back to whenever a gallery cannot hold it, so it is also the thing
 * most likely to be read on a bad day - a transfer that failed, a file somebody needs off the
 * device and into a folder.
 *
 * **Every state draws the same three columns at the same height.** A row that grew a progress bar
 * while it downloaded would move everything below it in the transcript, at the moment somebody is
 * reading it; only the glyph, the words and the trailing control change.
 *
 * The caption is the size at rest, both counts while fetching, and the reason when there is one.
 */
export function FileRow({
  filename,
  contentType,
  thumbnail,
  onOpen,
  caption,
  state,
  progress,
  actionLabel,
  onAction,
  testIDs,
}: FileRowProps) {
  const { head, tail } = splitFilename(filename)
  const format = fileFormat(filename)
  // On the name and the caption together, so the two share an edge.
  const direction = { direction: nameDirection(filename) }
  const tone = fileRowTone(state)
  const fontScale = useFontScale()

  const lead =
    thumbnail === undefined ? (
      <YStack
        width={FILE_GLYPH_SIDE}
        height={FILE_GLYPH_SIDE}
        borderRadius={tileRadius(FILE_GLYPH_SIDE)}
        alignItems="center"
        justifyContent="center"
        backgroundColor="$backgroundTertiary"
      >
        <Icon name={fileGlyph(filename, contentType)} size="sm" color="$textPrimary" />
      </YStack>
    ) : (
      <AttachmentTile
        side={FILE_GLYPH_SIDE}
        kind={thumbnail.kind}
        uri={thumbnail.uri}
        preview={thumbnail.preview}
        testID={testIDs?.thumbnail}
      />
    )

  return (
    <XStack
      alignItems="center"
      gap={FILE_ROW_GAP}
      paddingVertical="$xs"
      position="relative"
      testID={testIDs?.row}
      {...(onAction === undefined
        ? {}
        : { group: 'row' as const, '$platform-web': { cursor: 'pointer' }, onPress: onAction })}
    >
      {onAction === undefined ? null : (
        <StateLayer group="row" tone="ink" borderRadius="$sm" bleed={SPACING.xs} />
      )}
      <YStack
        width={FILE_LEAD_WIDTH}
        height={fileLeadHeight(fontScale)}
        alignItems="center"
        gap="$3xs"
      >
        {onOpen === undefined ? (
          lead
        ) : (
          <YStack
            role="button"
            aria-label={filename}
            position="relative"
            group="tile"
            $platform-web={{ cursor: 'pointer' }}
            onPress={(event) => {
              // Opening the picture is not the row's download or export.
              event.stopPropagation()
              onOpen()
            }}
          >
            {lead}
            <StateLayer group="tile" tone="scrim" borderRadius={tileRadius(FILE_GLYPH_SIDE)} />
            {thumbnail?.fetchesOnOpen === true ? (
              <FetchHint side={FILE_GLYPH_SIDE} group="tile" />
            ) : null}
          </YStack>
        )}
        {/* Under the lead rather than in the caption line, where it was competing with the size
            for the same run of small grey text. It also gives every row the same two-line lead, so
            the rows align down the message - and on a thumbnail it is what says "video". */}
        {format === '' ? null : (
          <Text size="$caption" tone="secondary" weight="semibold" numberOfLines={1}>
            {format}
          </Text>
        )}
      </YStack>

      <YStack flex={1} minWidth={0} gap="$3xs" style={direction}>
        {/* Two runs: the head gives up whatever width the row is short of and the tail cannot,
            so a long name loses its middle instead of its extension. See `splitFilename`.

            The id and the label are on the pair, never on a run: split between two elements the
            name stops being one string, and both a screen reader and a test then read half. */}
        <XStack minWidth={0} aria-label={filename} testID={testIDs?.name}>
          <Text
            size="$body"
            weight="semibold"
            tone={tone.name}
            numberOfLines={1}
            ellipsizeMode="tail"
            flexShrink={1}
            minWidth={0}
          >
            {head}
          </Text>
          <Text size="$body" weight="semibold" tone={tone.name} numberOfLines={1} flexShrink={0}>
            {tail}
          </Text>
        </XStack>
        {/* Sized to its words, so the column's direction places it rather than each platform's
            own alignment of a line of text. */}
        <Text
          size="$caption"
          tone={tone.caption}
          numberOfLines={1}
          alignSelf="flex-start"
          maxWidth="100%"
          style={CAPTION_BIDI}
          testID={testIDs?.caption}
        >
          {caption}
        </Text>
      </YStack>

      <Trailing
        state={state}
        progress={progress}
        actionLabel={actionLabel}
        onAction={onAction}
        testID={testIDs?.action}
      />
    </XStack>
  )
}
