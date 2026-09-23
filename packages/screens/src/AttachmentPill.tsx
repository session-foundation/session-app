import { tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'
import { Progress, Text, TILE_SCRIM, XStack, YStack } from '@session/ui'

import type { AttachmentSet } from './attachmentSet'
import { formatBytes } from './formatBytes'
import { PENDING_COPY } from './pendingCopy'

/**
 * What the set is doing, in the album's corner.
 *
 * **Never centred on a tile.** A badge on a tile reads as that tile's state, and this one is about
 * the whole message - including the attachments behind "+N" that the gallery is not drawing. The
 * corner is what says it belongs to the album rather than to the picture under it.
 *
 * On a scrim of its own, because it is drawn over somebody's photograph in one theme and over a
 * near-white placeholder in the other, and white on maybe-white is not a design.
 *
 * Nothing here is a control: the footer under the album carries the verb, where there is room for
 * a word. This says only how far along it is.
 */
export function AttachmentPill({ set }: { set: AttachmentSet }) {
  if (set.state === 'ready') return null

  return (
    <XStack
      alignItems="center"
      gap="$xs"
      paddingHorizontal="$sm"
      paddingVertical="$3xs"
      borderRadius="$full"
      backgroundColor={TILE_SCRIM}
      testID={ELEMENT.conversation.attachmentPill}
    >
      <Text size="$caption" color="$textPrimary">
        {label(set)}
      </Text>
      {set.state !== 'fetching' ? null : (
        <YStack width={PILL_BAR_WIDTH}>
          <Progress
            // Absent rather than zero while the server has not said how big it is: the first
            // report of any transfer is 0 of 0, which means beginning and not empty.
            {...(set.total > 0 ? { value: set.done / set.total } : {})}
            color="$primaryColor"
            trackColor="$backgroundTertiary"
            testID={ELEMENT.conversation.attachmentProgress}
          />
        </YStack>
      )}
    </XStack>
  )
}

/** Enough of a bar to read as one, and not so much that the pill stops being a badge. */
const PILL_BAR_WIDTH = 44

function label(set: AttachmentSet): string {
  if (set.state === 'fetching') {
    return set.total === 0 ? tr('downloading') : formatBytes(set.done)
  }
  if (set.state === 'failed') return tr('failedToDownload')
  // Idle: how many there are and what they weigh, which is what somebody deciding needs. The
  // count is the half our aggregate never said, and no catalogue key takes one.
  const count = PENDING_COPY.attachmentCount(set.count)
  return set.size === undefined ? count : `${count} · ${formatBytes(set.size)}`
}
