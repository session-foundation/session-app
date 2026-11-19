import type { ConversationId, Message } from '@session/client'
import { useMessage, useSessionActions } from '@session/state'
import { tr } from '@session/localization'
import { ELEMENT } from '@session/test-ids'
import {
  BUBBLE_TAKES_PRESS,
  BubblePress,
  ContextMenuTarget,
  MessageFrame,
  ON_ACCENT_SECONDARY_OPACITY,
  Text,
  useMenuLongPress,
  XStack,
} from '@session/ui'
import { memo, useMemo, type ReactNode } from 'react'

import { ConversationUiContext, type ConversationUi } from './conversationUi'
import { attachmentsWidthPx } from './attachmentsWidth'
import { layoutLine } from './layoutLine'
import { MessageAttachments } from './MessageAttachments'
import { useAlbumGeometry } from './useAlbumGeometry'
import { offersRetry } from './messageRetry'
import { useMessageMenuOpener } from './useMessageMenuOpener'

/**
 * What a send state is called on screen. Only the ones worth showing say anything.
 *
 * A function rather than a table, because `tr` reads the locale when it is called: a table built
 * at module scope would be resolved once, on import, and keep whatever locale was in use then.
 */
export function stateLabel(message: Message): string | undefined {
  switch (message.sendState) {
    case 'pending':
    case 'sending':
      return tr('sending')
    case 'uploading':
      return tr('uploading')
    // Interrupted is a send the app stopped in the middle of; to its sender it did not send, and
    // Retry resumes it as it does a failed one.
    case 'failed':
    case 'interrupted':
      return tr('messageStatusFailedToSend')
    // A file the message needs is gone, or too large to send even re-encoded, which the
    // catalogue's "Error sending file" covers. Without attachments there is no key for either
    // state, so they say nothing rather than English only.
    case 'unsendable':
      return message.attachments.length > 0 ? tr('attachmentsErrorSending') : undefined
    default:
      return undefined
  }
}

/** A failed send's Retry, inside the message's menu target so its long press opens the menu. */
function RetryLink({ onPress }: { onPress: () => void }) {
  const menuLongPress = useMenuLongPress()
  return (
    <Text
      size="$caption"
      color="$onAccent"
      weight="semibold"
      textDecorationLine="underline"
      testID={ELEMENT.conversation.messageRetry}
      {...menuLongPress}
      onPress={onPress}
    >
      {tr('retry')}
    </Text>
  )
}

/**
 * One message, read by id so an event that changes one message re-renders one row.
 *
 * `index` is the row's place in the transcript and only addresses it for tests.
 */
export const MessageRow = memo(function MessageRow({
  conversationId,
  messageId,
  index,
}: {
  conversationId: ConversationId
  messageId: number
  index: number
}) {
  const actions = useSessionActions()
  const message = useMessage(conversationId, messageId)
  const geometry = useAlbumGeometry()
  const openMyMenu = useMessageMenuOpener(messageId)
  if (message === undefined) return null
  // A caption wraps at its attachments' width, so a narrow picture keeps a narrow bubble.
  const attachmentsWidth =
    message.attachments.length === 0 ? undefined : attachmentsWidthPx(message, geometry)

  const state = message.outgoing ? stateLabel(message) : undefined
  const retryable = offersRetry(message)
  // A word of caption is too small a target for a finger, and the bubble has no room to draw it
  // bigger: on a phone the whole bubble retries.
  const bubbleRetries = retryable && BUBBLE_TAKES_PRESS
  const label =
    state !== undefined && bubbleRetries ? layoutLine(' · ', state, tr('tapToRetry')) : state
  const retry = () => {
    // Resumes rather than restarts. The state comes back as an update, so there is nothing to do
    // here.
    void actions.retry(message.id)
  }

  const frame = (
    <MessageFrame
      outgoing={message.outgoing}
      focusable
      testID={ELEMENT.conversation.messageRow(index)}
    >
      {message.body.length === 0 ? null : (
        <Text
          size="$body"
          color={message.outgoing ? '$onAccent' : '$messageBubbleIncomingText'}
          {...(attachmentsWidth === undefined ? {} : { maxWidth: attachmentsWidth })}
          testID={ELEMENT.conversation.messageBody}
        >
          {message.body}
        </Text>
      )}
      {attachmentsWidth === undefined ? null : (
        <MessageAttachments message={message} width={attachmentsWidth} />
      )}
      {label === undefined ? null : (
        <XStack alignItems="center" gap="$xs">
          {/* On the fill, not on the page: a label only ever appears on an outgoing message. */}
          <Text
            size="$caption"
            color="$onAccent"
            opacity={ON_ACCENT_SECONDARY_OPACITY}
            testID={ELEMENT.conversation.messageState}
          >
            {label}
          </Text>
          {retryable && !bubbleRetries ? <RetryLink onPress={retry} /> : null}
        </XStack>
      )}
    </MessageFrame>
  )

  return (
    <ContextMenuTarget
      onOpen={openMyMenu}
      alignSelf={message.outgoing ? 'flex-end' : 'flex-start'}
      // Text wraps at four fifths of the row. Attachments are sized for the transcript already,
      // as a share of it that fits the row, and their caption wraps at them.
      maxWidth={attachmentsWidth === undefined ? '80%' : '100%'}
    >
      {bubbleRetries ? (
        <BubblePress onPress={retry} testID={ELEMENT.conversation.messageRetry}>
          {frame}
        </BubblePress>
      ) : (
        frame
      )}
    </ContextMenuTarget>
  )
})

const ignore = () => {}

/**
 * What a row asks of the screen around it, for rows drawn outside one: nothing they open opens.
 * For the component catalog, which draws real messages without a conversation.
 */
export function DetachedMessages({
  conversationId,
  children,
}: {
  conversationId: ConversationId
  children: ReactNode
}) {
  const ui = useMemo<ConversationUi>(
    () => ({
      conversationId,
      requestAutoDownloadPrompt: ignore,
      openViewer: ignore,
      openSheet: ignore,
      openMenu: ignore,
    }),
    [conversationId],
  )
  return <ConversationUiContext.Provider value={ui}>{children}</ConversationUiContext.Provider>
}
