import { formatBytes } from '@session/basic-types'
import { tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'
import {
  PressArea,
  SEGMENTED_TOGGLE_TARGET,
  SegmentedToggle,
  Text,
  toggleRowHeight,
  XStack,
  type Segment,
} from '@session/ui'

import type { AttachmentSet } from './attachmentSet'
import { sharedCaption } from './attachmentSetCaption'
import type { AttachmentView } from './attachmentView'
import { PENDING_COPY } from './pendingCopy'

/**
 * Tall enough for a caption and its touch target, and fixed.
 *
 * A number rather than letting the text set it: the whole point is that the height does not
 * change between states, and a line of copy that wraps in one locale would change it.
 */
const FOOTER_HEIGHT = 30

/**
 * The row's own box, taller than the line on touch: a slop never reaches past its parent, so the
 * toggle's target is only as tall as the row that holds it. The overhang comes back as margin, so
 * the line still takes 30 and nothing below moves.
 */
const ROW_HEIGHT = toggleRowHeight(FOOTER_HEIGHT, SEGMENTED_TOGGLE_TARGET)

/**
 * How far the row reaches past its line above and below; zero on the web, where the row is the
 * line.
 *
 * The footer's targets cover the overhang and win over anything drawn under it, so whatever holds
 * the footer leaves at least this much empty above the line.
 */
export const ROW_OVERHANG = (ROW_HEIGHT - FOOTER_HEIGHT) / 2

/** Clipped to the row like the toggle's, so the verb's target is the row's full height. */
const ACTION_SLOP = SEGMENTED_TOGGLE_TARGET / 2

/**
 * Gallery or list, for a set that can be drawn either way.
 *
 * **Not a failure fallback.** Five photographs read perfectly well as five rows - with a name, a
 * size and a control each - and that is a reasonable thing to want without anything having gone
 * wrong. Where the set has a plain file in it there is no choice to offer, and the footer draws
 * no toggle rather than one with one working half.
 */
const VIEW_SEGMENTS: readonly [Segment<AttachmentView>, Segment<AttachmentView>] = [
  {
    value: 'gallery',
    icon: 'layoutGrid',
    label: PENDING_COPY.attachmentViewGallery,
    testID: ELEMENT.conversation.attachmentViewGallery,
  },
  {
    value: 'list',
    icon: 'list',
    label: PENDING_COPY.attachmentViewList,
    testID: ELEMENT.conversation.attachmentViewList,
  },
]

function caption(set: AttachmentSet): string {
  const shared = sharedCaption(set)
  if (shared !== null) return shared
  if (set.state === 'fetching') {
    return `${formatBytes(set.doneBytes)} / ${formatBytes(set.totalBytes)}`
  }
  return set.sizeBytes === undefined ? '' : formatBytes(set.sizeBytes)
}

/**
 * The one thing this state offers, or null where it offers nothing.
 *
 * Null rather than a disabled word, and the height does not move either way. There is no verb
 * while a transfer runs because nothing can stop one yet - the bridge has no cancel - and none on
 * a set of several that has arrived, because exporting them needs a directory to put them in and
 * offering one Export that quietly writes the first is worse than offering none.
 */
function verb(set: AttachmentSet): string | null {
  if (set.state === 'fetching' || set.state === 'unavailable') return null
  if (set.state === 'failed') return tr('retry')
  // TODO: offer Export for a set of several once `FilesPort` can pick a folder to put them in.
  if (set.state === 'ready') return set.count === 1 ? PENDING_COPY.export : null
  return tr('download')
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
}: {
  set: AttachmentSet
  onAction: () => void
  /** The shape being drawn. Absent where the reader has no choice about it. */
  view?: AttachmentView | undefined
  onView?: ((view: AttachmentView) => void) | undefined
}) {
  const action = verb(set)
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
        <SegmentedToggle
          segments={VIEW_SEGMENTS}
          value={view}
          onChange={onView}
          testID={ELEMENT.conversation.attachmentViewToggle}
        />
      )}
      <Text
        size="$caption"
        color="$textSecondary"
        flex={1}
        numberOfLines={1}
        testID={ELEMENT.conversation.attachmentState}
      >
        {caption(set)}
      </Text>
      {action === null ? null : (
        <PressArea
          onPress={onAction}
          accessibilityLabel={action}
          hitSlop={ACTION_SLOP}
          testID={ELEMENT.conversation.attachmentAction}
        >
          {() => (
            <Text
              size="$caption"
              weight="semibold"
              color={set.state === 'failed' ? '$dangerColor' : '$accentText'}
            >
              {action}
            </Text>
          )}
        </PressArea>
      )}
    </XStack>
  )
}
