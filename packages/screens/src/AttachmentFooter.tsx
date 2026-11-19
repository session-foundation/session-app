import { flag } from '@session/app'
import { formatBytes } from '@session/basic-types'
import { isolate, PENDING_COPY, tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'
import {
  Button,
  buttonHeight,
  ButtonProgress,
  Icon,
  type IconName,
  inkFor,
  ROW_TOUCH_TARGET,
  SPACE_SCALE,
  Text,
  XStack,
} from '@session/ui'

import type { AttachmentSet } from './attachmentSet'
import { sharedCaption } from './attachmentSetCaption'
import { layoutLine } from './layoutLine'
import type { AttachmentView } from './attachmentView'
import type { SendingFooter } from './useAttachmentFooter'

const ACTION_SIZE = 'sm'

/**
 * The verb's side, the tallest thing on the line, and fixed: the verb is a glyph in every state,
 * and a running transfer's ring is drawn in the same frame.
 *
 * A number rather than letting the caption set it: the whole point is that the height does not
 * change between states, and a line of copy that wraps in one locale would change it.
 */
const FOOTER_HEIGHT = buttonHeight(ACTION_SIZE)

/**
 * The row's own box, taller than the line on touch: a slop never reaches past its parent, so a
 * button's target is only as tall as the row that holds it. The overhang comes back as margin, so
 * the line still takes FOOTER_HEIGHT and nothing below moves.
 */
const ROW_HEIGHT = Math.max(FOOTER_HEIGHT, ROW_TOUCH_TARGET)

/**
 * How far the row reaches past its line above and below; zero on the web, where the row is the
 * line.
 *
 * The footer's targets cover the overhang and win over anything drawn under it, so whatever holds
 * the footer leaves at least this much empty above the line.
 */
const ROW_OVERHANG = (ROW_HEIGHT - FOOTER_HEIGHT) / 2

/**
 * The space above the footer's line, wherever it is drawn: under an album or a list in a message,
 * and under the sheet's list, so the two look alike. It clears the overhang too.
 */
export const FOOTER_CLEARANCE = SPACE_SCALE['2xs'] + ROW_OVERHANG

/**
 * The least the caption keeps beside the two buttons: a size such as "2.4 MB", which leads any
 * caption that has one, or its start.
 */
const CAPTION_MIN_WIDTH_PX = 48

/**
 * The narrowest the footer is drawn: the view switch and the verb, both square, and the caption's
 * least between them. What a message holding one narrow picture is no narrower than.
 */
export const FOOTER_MIN_WIDTH_PX = 2 * FOOTER_HEIGHT + 2 * SPACE_SCALE.xs + CAPTION_MIN_WIDTH_PX

/**
 * The other shape, as the one button offers it: the gallery from the list, and the list back.
 *
 * Only drawn where the set can be a gallery at all, so a list of plain files offers nothing.
 */
const SWITCH_TO = {
  list: {
    view: 'gallery',
    icon: 'layoutGrid',
    label: PENDING_COPY.attachmentViewGallery,
    testID: ELEMENT.conversation.attachmentViewGallery,
  },
  gallery: {
    view: 'list',
    icon: 'list',
    label: PENDING_COPY.attachmentViewList,
    testID: ELEMENT.conversation.attachmentViewList,
  },
} as const

/** The verb's glyph, saying what its word, the button's name, says. */
function verbIcon(set: AttachmentSet, sending: boolean): IconName {
  if (sending || set.state === 'failed') return 'rotateCw'
  return set.state === 'ready' ? 'download' : 'cloudDownload'
}

function caption(set: AttachmentSet): string {
  return (
    sharedCaption(set) ?? layoutLine(' / ', formatBytes(set.doneBytes), formatBytes(set.totalBytes))
  )
}

/**
 * The one thing this state offers, or null where it offers nothing.
 *
 * Null rather than a disabled glyph, and the height does not move either way. There is no verb
 * while a transfer runs because nothing can stop one yet - the bridge has no cancel - so its ring
 * stands in the verb's place instead. There is none on a set of several that has arrived, because
 * exporting them needs a directory to put them in and offering one Export that quietly writes the
 * first is worse than offering none.
 */
function verb(set: AttachmentSet): string | null {
  if (set.state === 'fetching' || set.state === 'unavailable') return null
  if (set.state === 'failed') return tr('retry')
  // TODO: offer Export for a set of several once `FilesPort` can pick a folder to put them in.
  if (set.state === 'ready') return set.count === 1 ? PENDING_COPY.export : null
  return tr('download')
}

/**
 * A running download or upload, in the verb's frame.
 *
 * The ring waits, turning round a closed track, until a byte has moved: the first report of a
 * transfer is 0 of 0, which means beginning rather than 0%, and a set some sender declared no size
 * for, or ours with a file whose upload has not begun, has no total to read a share of at all.
 * When bytes move its gap opens and the fill starts.
 */
function TransferRing({
  doneBytes,
  totalBytes,
  label,
}: {
  doneBytes: number
  totalBytes: number
  label: string
}) {
  const shared = {
    size: ACTION_SIZE,
    label,
    still: flag('disableAnimations'),
    testID: ELEMENT.conversation.attachmentProgress,
  } as const
  if (doneBytes === 0 || totalBytes === 0) return <ButtonProgress {...shared} indeterminate />
  return (
    <ButtonProgress
      {...shared}
      progress={doneBytes / totalBytes}
      valueText={PENDING_COPY.attachmentsDownloadProgress(
        isolate(formatBytes(doneBytes)),
        isolate(formatBytes(totalBytes)),
      )}
    />
  )
}

/**
 * The one line a message's attachments get, whatever they are doing.
 *
 * **Always drawn, and always the same height.** A footer that appeared when a download finished
 * would change the message's height at the moment somebody is reading it, and in a transcript
 * that moves everything below. Only the words and the verb change between states.
 *
 * Its scope is the message rather than the gallery: the count is every attachment, including the
 * ones behind "+N" that are never drawn.
 */
export function AttachmentFooter({
  set,
  onAction,
  view,
  onView,
  onAccent = false,
  sending,
}: {
  set: AttachmentSet
  onAction: () => void
  /**
   * Set while our message's files are still uploading or failed to: the line is then about the
   * upload, its ring stands in the verb's place while it runs, and its one verb is the message's
   * retry.
   *
   * That Retry is not drawn destructive: the danger colour on the tonal fill is 3.3 to 4.1:1 in
   * the four themes. The caption and the message's own state already say it failed.
   */
  sending?: SendingFooter | undefined
  /** Drawn on a bubble you sent rather than on the page; the buttons keep their own fill. */
  onAccent?: boolean | undefined
  /** The shape being drawn. Absent where the reader has no choice about it. */
  view?: AttachmentView | undefined
  onView?: ((view: AttachmentView) => void) | undefined
}) {
  const action = sending === undefined ? verb(set) : sending.retryable ? tr('retry') : null
  return (
    <XStack
      height={ROW_HEIGHT}
      marginVertical={-ROW_OVERHANG}
      alignItems="center"
      gap="$xs"
      // Only the controls take a touch; the rest of the row lets one through to what is under it.
      pointerEvents="box-none"
      testID={ELEMENT.conversation.attachmentFooter}
    >
      {view === undefined || onView === undefined ? null : (
        <Button
          variant="tonal"
          size={ACTION_SIZE}
          circular
          icon={<Icon name={SWITCH_TO[view].icon} size="sm" color="$textPrimary" />}
          accessibilityLabel={SWITCH_TO[view].label}
          // The row's full height, as a box a screen reader and an audit read as the button.
          touchTarget={ROW_HEIGHT}
          onAccent={onAccent}
          onPress={() => {
            onView(SWITCH_TO[view].view)
          }}
          testID={SWITCH_TO[view].testID}
        />
      )}
      <Text
        size="$caption"
        {...inkFor('secondary', onAccent)}
        flex={1}
        numberOfLines={1}
        testID={ELEMENT.conversation.attachmentState}
      >
        {sending === undefined ? caption(set) : sending.caption}
      </Text>
      {sending === undefined && set.state === 'fetching' ? (
        <TransferRing
          doneBytes={set.doneBytes}
          totalBytes={set.totalBytes}
          label={tr('downloading')}
        />
      ) : sending?.uploading !== undefined ? (
        <TransferRing
          doneBytes={sending.uploading.doneBytes}
          totalBytes={sending.uploading.totalBytes}
          label={tr('uploading')}
        />
      ) : action === null ? null : (
        // A glyph at every width, named by its word: the footer never has to choose between the
        // word and the caption, and the line is the same at every width a message is drawn.
        <Button
          variant="tonal"
          size={ACTION_SIZE}
          circular
          icon={<Icon name={verbIcon(set, sending !== undefined)} size="sm" color="$textPrimary" />}
          accessibilityLabel={action}
          touchTarget={ROW_HEIGHT}
          destructive={sending === undefined && set.state === 'failed'}
          onAccent={onAccent}
          onPress={onAction}
          testID={ELEMENT.conversation.attachmentAction}
        />
      )}
    </XStack>
  )
}
