import type { Attachment, AutoDownload, Message } from '@session/client'
import { tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'
import { forwardChevron, Icon, PressArea, Text, XStack, YStack } from '@session/ui'

import { AttachmentRow } from './AttachmentRow'
import { viewerIndices } from './viewableAttachments'

/**
 * How many rows a message draws before the rest moves into a sheet.
 *
 * Past this the message stops being a message with attachments and becomes a wall of rows: on a
 * phone, fourteen of them are four screenfuls, and everything said after them is unreachable
 * without scrolling past the lot. Eight is about a screenful, which is the point where the
 * transcript still reads as a conversation.
 */
export const LIST_MAX_ROWS = 8

/**
 * Every attachment on one message, as rows.
 *
 * Message order, every attachment, pictures included: the set is one object and a list that drew
 * only the documents would be the second half of a message whose first half is a gallery.
 *
 * Each row carries its own state, its own progress and its own control - which is what the album
 * cannot do, because a tile has nowhere to put one.
 */
export function AttachmentList({
  message,
  onOpen,
  onFirstDownload,
  autoDownload,
  onShowAll,
}: {
  message: Message
  /** Takes a position in the viewer's set, not in the message. See `viewerIndices`. */
  onOpen: (at: number) => void
  onFirstDownload?: (() => void) | undefined
  /** What this conversation fetches unasked. Undefined means nobody has been asked. */
  autoDownload?: AutoDownload | undefined
  /**
   * Opens the rest.
   *
   * Absent in the sheet itself, which is where "the rest" already is - so the same component
   * draws both, capped in the transcript and whole inside the sheet.
   */
  onShowAll?: (() => void) | undefined
}) {
  const viewer = viewerIndices(message)
  const capped =
    onShowAll === undefined ? message.attachments : message.attachments.slice(0, LIST_MAX_ROWS)
  const hidden = message.attachments.length - capped.length

  return (
    <YStack>
      {capped.map((attachment: Attachment) => {
        const at = viewer.get(attachment.index)
        return (
          <AttachmentRow
            key={attachment.index}
            message={message}
            attachment={attachment}
            onFirstDownload={onFirstDownload}
            autoDownload={autoDownload}
            {...(at === undefined
              ? {}
              : {
                  onOpen: () => {
                    onOpen(at)
                  },
                })}
          />
        )
      })}
      {hidden === 0 || onShowAll === undefined ? null : (
        <ShowAll count={message.attachments.length} onPress={onShowAll} />
      )}
    </YStack>
  )
}

/**
 * The row that opens the rest.
 *
 * It says how many there are in total rather than how many are hidden: somebody deciding whether
 * to open it wants the size of the thing they are opening, and "6 more" makes them add.
 */
function ShowAll({ count, onPress }: { count: number; onPress: () => void }) {
  return (
    <PressArea onPress={onPress} testID={ELEMENT.conversation.attachmentShowAll}>
      {() => (
        <XStack alignItems="center" gap="$xs" paddingVertical="$xs">
          <Text size="$label" weight="semibold" color="$accentText" flex={1}>
            {tr('showAll')}
          </Text>
          <Text size="$label" tone="secondary">
            {count}
          </Text>
          <Icon name={forwardChevron()} size="sm" color="$textSecondary" />
        </XStack>
      )}
    </PressArea>
  )
}
