import { XStack, YStack } from 'tamagui'

import { AttachmentTile } from './AttachmentTile'
import { fileFormat, fileGlyph, splitFilename } from './attachmentFile'
import {
  FILE_GLYPH_SIDE,
  FILE_LEAD_WIDTH,
  FILE_ROW_CONTROL,
  FILE_ROW_GAP,
  fileRowControl,
  type FileRowState,
} from './fileRow'
import { Icon } from './Icon'
import { PressArea } from './PressArea'
import { ProgressRing } from './ProgressRing'
import { Text } from './Text'
import { tileRadius } from './attachmentTile'

export interface FileRowTestIDs {
  row?: string
  name?: string
  caption?: string
  action?: string
  /** Addresses the picture inside the thumbnail, so a test can ask whether it arrived. */
  thumbnail?: string
}

/** What the lead square shows when the row is for something with a picture behind it. */
export interface FileRowThumbnail {
  /** Where the bytes are, once they are here. Null where the platform has no resolver. */
  uri?: string | null
  kind: 'image' | 'video'
  /** The sender's BlurHash, where they sent one. Checked in `blurhashColor`, not here. */
  blurhash?: string
}

export interface FileRowProps {
  filename: string
  /** The sender's declared type. Absent on plenty of attachments, which the glyph copes with. */
  contentType?: string
  /**
   * The picture this row stands for, where it has one.
   *
   * The same tile the album draws, at the smaller radius step: a list of pictures and a list of
   * documents are the same list, and the leading square is the one thing that differs.
   */
  thumbnail?: FileRowThumbnail
  /** Opens what the lead square shows. Absent where there is nothing to open. */
  onOpen?: () => void
  /**
   * The one line under the name, already worded.
   *
   * The size at rest, both counts while fetching, the reason when there is one. A string rather
   * than the numbers because every one of those readings is a catalogue key, and `@session/ui`
   * imports no sibling but theme-tokens, test-ids and basic-types.
   */
  caption: string
  state: FileRowState
  /** How far along, 0 to 1. Absent until the server has said how big the file is. */
  progress?: number
  /** Already worded, for what a screen reader announces the trailing control as. */
  actionLabel?: string
  onAction?: () => void
  testIDs?: FileRowTestIDs
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
  const tone = state === 'failed' ? 'danger' : 'primary'

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
        {...(thumbnail.uri === undefined ? {} : { uri: thumbnail.uri })}
        {...(thumbnail.blurhash === undefined ? {} : { blurhash: thumbnail.blurhash })}
        {...(testIDs?.thumbnail === undefined ? {} : { testID: testIDs.thumbnail })}
      />
    )

  return (
    <XStack alignItems="center" gap={FILE_ROW_GAP} paddingVertical="$xs" testID={testIDs?.row}>
      <YStack width={FILE_LEAD_WIDTH} alignItems="center" gap="$3xs">
        {onOpen === undefined ? (
          lead
        ) : (
          <PressArea onPress={onOpen} accessibilityLabel={filename}>
            {() => lead}
          </PressArea>
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

      <YStack flex={1} minWidth={0} gap="$3xs">
        {/* Two runs: the head gives up whatever width the row is short of and the tail cannot,
            so a long name loses its middle instead of its extension. See `splitFilename`.

            The id and the label are on the pair, never on a run: split between two elements the
            name stops being one string, and both a screen reader and a test then read half of it. */}
        <XStack minWidth={0} accessibilityLabel={filename} testID={testIDs?.name}>
          <Text
            size="$body"
            weight="semibold"
            tone={tone}
            numberOfLines={1}
            ellipsizeMode="tail"
            flexShrink={1}
            minWidth={0}
          >
            {head}
          </Text>
          <Text size="$body" weight="semibold" tone={tone} numberOfLines={1} flexShrink={0}>
            {tail}
          </Text>
        </XStack>
        <Text
          size="$caption"
          tone={state === 'failed' || state === 'unavailable' ? 'danger' : 'secondary'}
          numberOfLines={1}
          testID={testIDs?.caption}
        >
          {caption}
        </Text>
      </YStack>

      <Trailing
        state={state}
        {...(progress === undefined ? {} : { progress })}
        {...(actionLabel === undefined ? {} : { actionLabel })}
        {...(onAction === undefined ? {} : { onAction })}
        {...(testIDs?.action === undefined ? {} : { testID: testIDs.action })}
      />
    </XStack>
  )
}

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
  progress?: number
  actionLabel?: string
  onAction?: () => void
  testID?: string
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
    return (
      <YStack {...square}>
        <ProgressRing progress={progress ?? 0} size={RING_SIDE} thickness={RING_THICKNESS} />
      </YStack>
    )
  }

  return (
    <PressArea
      {...(onAction === undefined ? {} : { onPress: onAction })}
      {...(actionLabel === undefined ? {} : { accessibilityLabel: actionLabel })}
      {...(testID === undefined ? {} : { testID })}
    >
      {() => (
        <YStack
          {...square}
          borderRadius="$full"
          hoverStyle={{ backgroundColor: '$backgroundTertiary' }}
          pressStyle={{ backgroundColor: '$backgroundTertiary' }}
        >
          <Icon
            name={control}
            size="sm"
            color={state === 'failed' ? '$dangerColor' : '$textPrimary'}
          />
        </YStack>
      )}
    </PressArea>
  )
}

/** Drawn inside the touch target rather than filling it, so it reads as a gauge and not a button. */
const RING_SIDE = 28
const RING_THICKNESS = 3
