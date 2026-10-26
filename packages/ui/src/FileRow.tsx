import { Platform } from 'react-native'
import { isWeb, XStack, YStack } from 'tamagui'

import { SPACING } from '@session/theme-tokens'

import type {
  WithCaption,
  WithContentType,
  WithFetchesOnOpen,
  WithFilename,
  WithMediaThumbhash,
  WithMediaUri,
} from '@session/basic-types'
import type { ElementId } from '@session/test-ids'

import { AttachmentTile } from './AttachmentTile'
import { fileFormat, fileGlyph, nameDirection, splitFilename } from './attachmentFile'
import {
  fileRowAccessibleName,
  fileRowActions,
  listedFileRowActions,
  type FileRowAction,
} from './fileRowAccessibility'
import {
  FILE_GLYPH_SIDE,
  FILE_LEAD_WIDTH,
  FILE_ROW_CONTROL,
  FILE_ROW_GAP,
  fileLeadHeight,
  fileRowControl,
  fileRowTone,
  type FileRowState,
} from './fileRowState'
import { FetchHint } from './FetchHint'
import { Icon } from './Icon'
import { inkFor } from './ink'
import { focusRing, heldButton, keyboardPress } from './keyboardPress'
import { pressHint } from './pressHint'
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
  /** The lead square where it takes a press, which is what a test taps in every state. */
  lead?: ElementId | undefined
  /** Addresses the picture inside the thumbnail, so a test can ask whether it arrived. */
  thumbnail?: ElementId | undefined
}

/** What the lead square shows when the row is for something with a picture behind it. */
export type FileRowThumbnail = WithMediaUri & WithMediaThumbhash & WithFetchesOnOpen

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
     * rest of the row is `onPress`'s. */
    onOpen?: (() => void) | undefined
    /**
     * Already worded, for what a screen reader says a press on the lead square does. Absent while
     * that press does nothing, which leaves the square out of the tab order unless it is fetching.
     */
    openLabel?: string | undefined
    /**
     * A press on the row outside the lead square and the control. Absent where it does nothing.
     *
     * On the web it is the pointer's alone, so the lead square or the control must offer the same
     * verb to the keyboard.
     */
    onPress?: (() => void) | undefined
    /** Already worded, for what a screen reader says a press on the row does. Native only. */
    pressLabel?: string | undefined
    state: FileRowState
    /** How far along, 0 to 1. Absent until the server has said how big the file is. */
    progress?: number | undefined
    /**
     * Already worded, for what a screen reader announces the trailing control as, the progress ring
     * included.
     */
    actionLabel?: string | undefined
    /** The trailing control's press, which need not be the row's. */
    onAction?: (() => void) | undefined
    testIDs?: FileRowTestIDs | undefined
    /**
     * Drawn on an accent fill, a bubble you sent, so its text and glyphs take `$onAccent`. The
     * lead square and the thumbnail keep their own fill either way.
     */
    onAccent?: boolean | undefined
  }

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
 * The row as the one accessibility element, on native alone: iOS hides whatever an element holds,
 * so the lead square's and the control's verbs are its actions. On the web it would be a button
 * holding theirs, whose children ARIA makes presentational.
 */
function nativeRowElement({
  name,
  actions,
  pressable,
  held,
  progress,
}: {
  name: string
  actions: FileRowAction[]
  pressable: boolean
  held: boolean
  progress: number | undefined
}) {
  if (isWeb) return {}
  const activate = actions.find((action) => action.name === 'activate')
  const operable = pressable || activate !== undefined
  return {
    accessible: true,
    ...(operable || held ? { role: 'button' } : {}),
    'aria-label': name,
    ...pressHint(activate?.label),
    // Set in every state: Android keeps a disabled state that is dropped rather than cleared.
    'aria-disabled': !operable && held,
    'aria-busy': held,
    accessibilityValue:
      held && progress !== undefined
        ? { min: 0, max: 100, now: Math.round(Math.min(Math.max(progress, 0), 1) * 100) }
        : {},
    // iOS's double-tap calls this alone; without it VoiceOver taps the row's middle, which has no
    // press when the verb is the control's.
    ...(activate === undefined ? {} : { onAccessibilityTap: activate.run }),
    accessibilityActions: listedFileRowActions(actions, Platform.OS).map(
      ({ name: action, label }) => ({ name: action, label }),
    ),
    onAccessibilityAction: (event: { nativeEvent: { actionName: string } }) => {
      actions.find((action) => action.name === event.nativeEvent.actionName)?.run()
    },
  } as const
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
  onAccent,
}: {
  state: FileRowState
  progress?: number | undefined
  actionLabel?: string | undefined
  onAction?: (() => void) | undefined
  testID?: ElementId | undefined
  onAccent: boolean
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

  const ring = focusRing({ onAccent, offset: 0, radius: '$full' })
  // While a transfer runs, a disabled button showing progress, since the bridge has no cancel. The
  // same element as the Download that started it, so focus stays put. The caption has the counts.
  // TODO: make this a cancel once libsession and the bridge can stop a transfer.
  const held = control === 'progress'

  return (
    <YStack
      {...square}
      position="relative"
      group="control"
      testID={testID}
      {...(held ? {} : { '$platform-web': { cursor: 'pointer' as const } })}
      {...(!isWeb
        ? {}
        : held
          ? heldButton(actionLabel, ring)
          : {
              role: 'button' as const,
              ...(actionLabel === undefined ? {} : { 'aria-label': actionLabel }),
              ...keyboardPress(onAction, ring),
            })}
      {...(isWeb ? { 'aria-disabled': held } : {})}
      onPress={
        held
          ? undefined
          : (event) => {
              // The control's verb is its own, and the row's press may be another.
              event.stopPropagation()
              onAction?.()
            }
      }
    >
      {held ? (
        <ProgressRing
          progress={progress ?? 0}
          size={RING_SIDE}
          thickness={RING_THICKNESS}
          color={onAccent ? '$onAccent' : '$primaryColor'}
        />
      ) : (
        <>
          <StateLayer group="control" tone="ink" borderRadius="$full" />
          <Icon name={control} size="sm" {...inkFor(fileRowTone(state).control, onAccent)} />
        </>
      )}
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
  openLabel,
  onPress,
  pressLabel,
  caption,
  state,
  progress,
  actionLabel,
  onAction,
  testIDs,
  onAccent = false,
}: FileRowProps) {
  const { head, tail } = splitFilename(filename)
  const format = fileFormat(filename)
  // On the name and the caption together, so the two share an edge.
  const direction = { direction: nameDirection(filename) }
  const tone = fileRowTone(state)
  const nameInk = inkFor(tone.name, onAccent)
  const fontScale = useFontScale()
  // While fetching, the lead square stays a disabled button rather than losing its stop, which
  // would drop focus on it to the page.
  const held = state === 'fetching'
  const leadRing = focusRing({ onAccent, offset: 0, radius: tileRadius(FILE_GLYPH_SIDE) })
  const leadHeld = openLabel === undefined && held
  const control = fileRowControl(state)
  const actions = fileRowActions({
    onPress,
    pressLabel,
    onOpen,
    openLabel,
    onAction: control === null || control === 'progress' ? undefined : onAction,
    actionLabel,
  })

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
        uri={thumbnail.uri}
        thumbhash={thumbnail.thumbhash}
        testID={testIDs?.thumbnail}
      />
    )

  return (
    <XStack
      alignItems="center"
      gap={FILE_ROW_GAP}
      paddingVertical="$xs"
      position="relative"
      // A group in every state: tamagui remounts a view that gains or drops one, dropping focus.
      group="row"
      testID={testIDs?.row}
      {...(onPress === undefined ? {} : { '$platform-web': { cursor: 'pointer' }, onPress })}
      {...nativeRowElement({
        name: fileRowAccessibleName(filename, format, caption),
        actions,
        pressable: onPress !== undefined,
        held,
        progress,
      })}
    >
      {onPress === undefined ? null : (
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
            // On native the row carries this press as an action; see `nativeRowElement`.
            {...(openLabel === undefined || !isWeb
              ? {}
              : {
                  role: 'button' as const,
                  'aria-label': filename,
                  ...pressHint(openLabel),
                  ...keyboardPress(onOpen, leadRing),
                })}
            {...(leadHeld && isWeb ? heldButton(filename, leadRing) : {})}
            {...(isWeb ? { 'aria-disabled': leadHeld } : {})}
            position="relative"
            group="tile"
            $platform-web={{ cursor: 'pointer' }}
            testID={testIDs?.lead}
            onPress={
              leadHeld
                ? undefined
                : (event) => {
                    // Opening the picture is not the row's download or export.
                    event.stopPropagation()
                    onOpen()
                  }
            }
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
            the rows align down the message. */}
        {format === '' ? null : (
          <Text
            size="$caption"
            {...inkFor('secondary', onAccent)}
            weight="semibold"
            numberOfLines={1}
          >
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
            {...nameInk}
            numberOfLines={1}
            ellipsizeMode="tail"
            flexShrink={1}
            minWidth={0}
          >
            {head}
          </Text>
          <Text size="$body" weight="semibold" {...nameInk} numberOfLines={1} flexShrink={0}>
            {tail}
          </Text>
        </XStack>
        {/* Sized to its words, so the column's direction places it rather than each platform's
            own alignment of a line of text. */}
        <Text
          size="$caption"
          {...inkFor(tone.caption, onAccent)}
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
        onAccent={onAccent}
      />
    </XStack>
  )
}
