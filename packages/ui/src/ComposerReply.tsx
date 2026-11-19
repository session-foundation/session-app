import { XStack } from 'tamagui'

import type { ElementId } from '@session/test-ids'

import { Button } from './Button'
import { Icon } from './Icon'
import { inkFor } from './ink'
import { QuoteLines, STRIPE_OVERHANG_PX } from './MessageQuote'
import { isQuotable, quotePreview, type QuoteLabels, type QuotedMessage } from './quotePreview'
import { QuoteThumb } from './QuoteThumb'
import { ROW_TOUCH_TARGET } from './rowTouchTarget'

/** Smaller than the quote's square: the bar holds one line of summary, not two. */
const COMPOSER_REPLY_THUMB_SIDE_PX = 36

/** From the bar's edge to its text; no box, so its content starts at the composer's edge. */
const BAR_TEXT_INSET_BLOCK_PX = 10

export interface ComposerReplyProps {
  /**
   * `messageReplyingTo` and the author, composed by the caller with the author bidi-isolated: a
   * name ending in a neutral ("Bob!") otherwise draws that neutral on the wrong side in RTL.
   */
  heading: string
  /**
   * Absent or deleted: the message being answered is gone, and the bar with it. The text being
   * written is the composer's, and stays.
   */
  message: QuotedMessage | undefined
  labels: QuoteLabels
  onClose: () => void
  /** `close`, already worded. */
  closeLabel: string
  testID?: ElementId | undefined
  closeTestID?: ElementId | undefined
  thumbnailTestID?: ElementId | undefined
}

/**
 * Above the composer's input while a reply is being written: what it answers, in one line, and
 * the X that stops replying. Esc is the composer's to handle, since it is the input that has focus.
 */
export function ComposerReply({
  heading,
  message,
  labels,
  onClose,
  closeLabel,
  testID,
  closeTestID,
  thumbnailTestID,
}: ComposerReplyProps) {
  if (!isQuotable(message)) return null
  const preview = quotePreview(message, labels)
  return (
    <XStack
      alignItems="center"
      gap="$xs"
      paddingVertical={BAR_TEXT_INSET_BLOCK_PX - STRIPE_OVERHANG_PX}
      testID={testID}
    >
      <XStack flex={1} minWidth={0} alignSelf="stretch" gap="$xs">
        <QuoteLines
          heading={heading}
          preview={preview}
          ink="$textPrimary"
          secondary={inkFor('secondary', false)}
          stripe="$primaryColor"
          summaryLines={1}
          thumb={
            <QuoteThumb
              visual={preview.visual}
              sidePx={COMPOSER_REPLY_THUMB_SIDE_PX}
              ink="$textPrimary"
              testID={thumbnailTestID}
            />
          }
        />
      </XStack>
      <Button
        variant="ghost"
        size="sm"
        circular
        touchTarget={ROW_TOUCH_TARGET}
        icon={<Icon name="x" size="sm" color="$textSecondary" />}
        accessibilityLabel={closeLabel}
        onPress={onClose}
        {...(closeTestID === undefined ? {} : { testID: closeTestID })}
      />
    </XStack>
  )
}
