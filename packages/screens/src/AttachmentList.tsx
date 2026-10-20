import type { Attachment, Message } from '@session/client'
import { tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'
import { forwardChevron, Icon, PressArea, Text, XStack, YStack } from '@session/ui'

import { AttachmentRow } from './AttachmentRow'

/**
 * How many rows a message draws before the rest moves into a sheet.
 *
 * Past this the message stops being a message with attachments and becomes a wall of rows, and
 * everything said after them is unreachable without scrolling past the lot. Five leave room on a
 * phone screen for the messages around them, so the transcript still reads as a conversation.
 */
export const LIST_MAX_ROWS = 5

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
  onShowAll,
}: {
  message: Message
  /**
   * Opens the rest.
   *
   * Absent, every row is drawn and none is capped. The sheet draws the same `AttachmentRow`s
   * through a windowed list instead, since it is where a set too long to mount at once goes.
   */
  onShowAll?: (() => void) | undefined
}) {
  const capped =
    onShowAll === undefined ? message.attachments : message.attachments.slice(0, LIST_MAX_ROWS)
  const hidden = message.attachments.length - capped.length

  return (
    <YStack>
      {capped.map((attachment: Attachment) => (
        <AttachmentRow key={attachment.index} message={message} attachment={attachment} />
      ))}
      {hidden === 0 || onShowAll === undefined ? null : (
        <ShowAll count={message.attachments.length} onPress={onShowAll} />
      )}
    </YStack>
  )
}
